import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowRight, Bot, Calculator, CheckCircle2, LineChart, Search, Sparkles } from "lucide-react"

import { PublicHomePageContent } from "@/components/seo/public-home-page"
import { PublicPlatformDirectory } from "@/components/platform/public-platform-directory"
import { AiCostCalculator } from "@/components/seo/ai-cost-calculator"
import { PublicSiteFooter } from "@/components/seo/public-site-footer"
import { PublicSiteHeader } from "@/components/seo/public-site-header"
import { SeoLandingPage } from "@/components/seo/seo-landing-page"
import { Button } from "@/components/ui/button"
import { getServerSessionUser } from "@/lib/auth/server-session"
import { getPublicCopy } from "@/lib/i18n/public-copy"
import type { AppLocale } from "@/lib/i18n/config"
import { buildLocalizedPublicUrl, getLocalizedPublicAlternates, isLocalizedPublicPath, localizePublicPath } from "@/lib/i18n/routing"
import { listPlatformCapabilityExecutionStates } from "@/lib/platform/execution"
import { listPlatformRegistryEntryExecutionStates } from "@/lib/platform/registry-entry-execution"
import { getAiCostPageCopy, localizeSeoPage } from "@/lib/seo/i18n"
import { metadataForSeoPage } from "@/lib/seo/metadata"
import {
  getSeoPage,
  getSeoPagesByGroup,
  seoPathForPage,
} from "@/lib/seo/pages"

type LocalizedSeoGroup =
  | "agents"
  | "alternatives"
  | "compare"
  | "prompts"
  | "resources"
  | "use-cases"

type PlatformDirectoryPage = "agents" | "capabilities" | "plugins" | "mcp-services" | "workflows"

type PublicResourceEntry = {
  label: string
  title: string
  description: string
  href: string
}

function getPublicResourceDirectory(locale: AppLocale): PublicResourceEntry[] {
  return locale === "zh"
    ? [
        {
          label: "Brief",
          title: "什么是内容简报？",
          description: "定义 content brief 的作用、字段和如何衔接 SEO 生产工作流。",
          href: "/resources/what-is-a-content-brief",
        },
        {
          label: "Strategy",
          title: "什么是内容支柱？",
          description: "解释 content pillar、topic cluster 和 SEO 结构化内链之间的关系。",
          href: "/resources/what-is-a-content-pillar",
        },
        {
          label: "ROI",
          title: "内容营销 ROI",
          description: "把内容产出、工具成本和工作流效率放进同一个 ROI 视角里衡量。",
          href: "/resources/content-marketing-roi",
        },
        {
          label: "工具",
          title: "内容简报生成器",
          description: "先把 brief 结构化，再继续生成标题、Meta、FAQ 和内链方向。",
          href: "/tools/content-brief-generator",
        },
        {
          label: "对比",
          title: "营销团队适合什么 AI 工作台",
          description: "用对比页承接 workspace、替代方案和多模型协作相关搜索。",
          href: "/compare/best-ai-workspace-for-marketing-teams",
        },
        {
          label: "替代",
          title: "ChatGPT Team 替代方案",
          description: "承接从通用团队聊天产品迁移到营销工作台的商业型搜索意图。",
          href: "/alternatives/chatgpt-team-alternative",
        },
      ]
    : [
        {
          label: "Brief",
          title: "What is a content brief?",
          description: "Define the role of a content brief and how it supports SEO production before drafting begins.",
          href: "/resources/what-is-a-content-brief",
        },
        {
          label: "Strategy",
          title: "What is a content pillar?",
          description: "Explain how content pillars, topic clusters, and internal links work together in an SEO system.",
          href: "/resources/what-is-a-content-pillar",
        },
        {
          label: "ROI",
          title: "Content marketing ROI",
          description: "Measure content value alongside tool cost, workflow drag, and publish efficiency.",
          href: "/resources/content-marketing-roi",
        },
        {
          label: "Tool",
          title: "Content brief generator",
          description: "Start from one topic and turn it into a structured brief before generating final content.",
          href: "/tools/content-brief-generator",
        },
        {
          label: "Compare",
          title: "Best AI workspace for marketing teams",
          description: "A comparison page for workspace, alternatives, and multi-model collaboration intent.",
          href: "/compare/best-ai-workspace-for-marketing-teams",
        },
        {
          label: "Alternative",
          title: "ChatGPT Team alternative",
          description: "A commercial comparison entry for teams moving from general team chat to a marketing workspace.",
          href: "/alternatives/chatgpt-team-alternative",
        },
      ]
}

function getResourcesPageCopy(locale: AppLocale) {
  return locale === "zh"
    ? {
        eyebrow: "Resources",
        title: "把搜索入口组织成资源目录，而不是零散文章",
        description:
          "这里集中放置专题 hub、成本工具、使用场景和对比页，帮助搜索访客从信息查询自然进入 AI Marketing 的商业路径。",
        featuredTitle: "Claude Fable 5 专题入口",
        featuredDescription:
          "这个 hub 承接 Claude Fable 5 主词和相关长尾搜索，再通过内部链接把流量导向定价、提示词、SEO 场景和对比页。",
        featuredHref: "/claude/fable-5",
        featuredCta: "打开专题",
        directoryTitle: "资源目录",
        directoryDescription: "保留强 intent 页面，减少首页直接承载过多长尾主题。",
        proofPoints: [
          "首页继续承接 broad commercial intent，不和专题 cluster 抢词。",
          "Resources 目录给 crawler 和用户一个稳定的聚合入口。",
          "专题 hub、calculator、use cases 和 compare 页在同一目录中互相导流。",
        ],
      }
    : {
        eyebrow: "Resources",
        title: "Organize search entry points as a resource directory, not scattered articles",
        description:
          "This page groups the topic hub, cost tools, use cases, and comparison pages so search visitors can move from information intent into the AI Marketing buying path.",
        featuredTitle: "Claude Fable 5 topic hub",
        featuredDescription:
          "This hub captures the main Claude Fable 5 term and its long-tail searches, then routes traffic into pricing, prompts, SEO workflow, and comparison pages.",
        featuredHref: "/claude/fable-5",
        featuredCta: "Open topic hub",
        directoryTitle: "Resource directory",
        directoryDescription: "Keep the homepage focused on broad commercial intent instead of carrying too many long-tail topics directly.",
        proofPoints: [
          "The homepage stays focused on broad commercial intent instead of competing with the topical cluster.",
          "The Resources directory gives crawlers and users one stable aggregation point.",
          "The topic hub, calculator, use cases, and compare pages can route traffic into one another from a shared directory.",
        ],
      }
}

function getPlatformDirectoryHeadingCopy(locale: AppLocale, page: PlatformDirectoryPage) {
  const isZh = locale === "zh"

  switch (page) {
    case "agents":
      return {
        title: isZh ? "营销智能体广场" : "Marketing Agent Square",
        description: isZh
          ? "把可复用的营销角色、企业协作 Agent 和 deferred 入口统一整理进同一前台广场。"
          : "Bring reusable marketing roles, enterprise collaboration agents, and deferred entry points into one shared public square.",
      }
    case "capabilities":
      return {
        title: isZh ? "统一能力中心" : "Unified Capability Directory",
        description: isZh
          ? "把 AI 对话、AI PPT、AI 绘图、AI 视频和智能体组织进同一套平台注册表。"
          : "Organize AI chat, AI PPT, AI image, AI video, and agent capabilities through one shared registry.",
      }
    case "plugins":
      return {
        title: isZh ? "平台插件目录" : "Platform Plugin Directory",
        description: isZh
          ? "把图片、视频、知识、搜索和自动化扩展整理成平台插件位。"
          : "Organize image, video, knowledge, search, and automation extensions as platform plugin slots.",
      }
    case "mcp-services":
      return {
        title: isZh ? "MCP 服务目录" : "MCP Service Directory",
        description: isZh
          ? "把外部能力桥接、搜索、文档解析与市场数据接入点先整理成可见目录。"
          : "Expose external bridges, search, document parsing, and market data entry points through a visible MCP directory first.",
      }
    case "workflows":
      return {
        title: isZh ? "工作流模板中心" : "Workflow Template Center",
        description: isZh
          ? "把营销 brief、内容复用、视觉广告流程和 deferred 企业流程沉淀成统一模板。"
          : "Turn marketing briefs, content repurposing, visual ad pipelines, and deferred enterprise flows into shared templates.",
      }
  }
}

function getCapabilityExecutionLabel(
  locale: AppLocale,
  runtimeStatus: "ready" | "deferred" | "runtime_disabled",
  accessState: "public" | "public_then_login" | "login_required" | "authorized" | "permission_required" | "admin_required",
) {
  const runtimeLabel =
    locale === "zh"
      ? {
          ready: "运行中",
          deferred: "后续实现",
          runtime_disabled: "运行时关闭",
        }[runtimeStatus]
      : {
          ready: "Runtime ready",
          deferred: "Deferred",
          runtime_disabled: "Runtime disabled",
        }[runtimeStatus]

  const accessLabel =
    locale === "zh"
      ? {
          public: "公开可见",
          public_then_login: "先公开后登录",
          login_required: "需登录",
          authorized: "已授权",
          permission_required: "需企业权限",
          admin_required: "需管理员",
        }[accessState]
      : {
          public: "Public",
          public_then_login: "Public then login",
          login_required: "Login required",
          authorized: "Authorized",
          permission_required: "Permission required",
          admin_required: "Admin required",
        }[accessState]

  return `${runtimeLabel} · ${accessLabel}`
}

function getLocalizedSeoStaticParams(group: LocalizedSeoGroup) {
  return getSeoPagesByGroup(group)
    .filter((page) => isLocalizedPublicPath(seoPathForPage(page)))
    .map((page) => ({ slug: page.slug }))
}

function getLocalizedSeoMetadata(locale: AppLocale, group: LocalizedSeoGroup, slug: string) {
  const page = getSeoPage(group, slug)
  if (!page) return {}
  return metadataForSeoPage(localizeSeoPage(page, locale), locale)
}

function renderLocalizedSeoPage(locale: AppLocale, group: LocalizedSeoGroup, slug: string) {
  const page = getSeoPage(group, slug)
  if (!page) notFound()
  return <SeoLandingPage page={localizeSeoPage(page, locale)} locale={locale} />
}

export function getHomeMetadata(locale: AppLocale): Metadata {
  const canonical = buildLocalizedPublicUrl("/", locale)
  const title =
    locale === "zh"
      ? "Coworkany｜你的个人 AI 智能体工作台"
      : "Coworkany | Your Personal AI Agent Workspace"
  const description =
    locale === "zh"
      ? "Coworkany 是面向个人与团队的 AI 智能体工作台，整合 AI 对话、Agent、写作、图片、PPT、工作流与本地运行能力，让想法直接变成成果。"
      : "Coworkany is a personal AI agent workspace for turning ideas into outcomes with AI chat, agents, writing, image generation, presentations, workflows, and local runtime support."

  return {
    title: { absolute: title },
    description,
    alternates: {
      canonical,
      languages: getLocalizedPublicAlternates("/"),
    },
    openGraph: {
      title,
      description,
      url: canonical,
      siteName: "Coworkany",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  }
}

export async function renderHomePage(locale: AppLocale) {
  return <PublicHomePageContent locale={locale} />
}

export function getPricingMetadata(locale: AppLocale): Metadata {
  const copy = getPublicCopy(locale)
  const canonical = buildLocalizedPublicUrl("/pricing", locale)
  const title =
    locale === "zh"
      ? "面向营销团队的 AI 工作台价格 | AIMarketingSite"
      : "AI Workspace Pricing for Marketing Teams | AIMarketingSite"

  return {
    title,
    description: copy.pricingPage.description,
    alternates: {
      canonical,
      languages: getLocalizedPublicAlternates("/pricing"),
    },
    openGraph: {
      title,
      description: copy.pricingPage.description,
      url: canonical,
      siteName: "AIMarketingSite",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: copy.pricingPage.description,
    },
  }
}

export async function renderPricingPage() {
  const { PublicPricingPageContent } = await import("@/components/seo/public-pricing-page")
  return <PublicPricingPageContent />
}

export function getResourcesMetadata(locale: AppLocale): Metadata {
  const copy = getResourcesPageCopy(locale)
  const canonical = buildLocalizedPublicUrl("/resources", locale)
  const title = locale === "zh" ? "营销 AI 资源目录 | AIMarketingSite" : "Marketing AI Resource Directory | AIMarketingSite"

  return {
    title,
    description: copy.description,
    alternates: {
      canonical,
      languages: getLocalizedPublicAlternates("/resources"),
    },
    openGraph: {
      title,
      description: copy.description,
      url: canonical,
      siteName: "AIMarketingSite",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: copy.description,
    },
  }
}

export function renderResourcesPage(locale: AppLocale) {
  const copy = getResourcesPageCopy(locale)
  const resources = getPublicResourceDirectory(locale)
  const featuredHref = localizePublicPath(copy.featuredHref, locale)
  const iconList = [Bot, Calculator, Sparkles, Search, LineChart, CheckCircle2] as const

  return (
    <main className="min-h-screen bg-background text-foreground">
      <PublicSiteHeader activeKey="resources" />

      <section className="public-grid-bg mx-auto max-w-7xl px-6 py-16 lg:py-20">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_360px]">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="public-kicker text-muted-foreground">{copy.eyebrow}</p>
              <span className="public-system-chip public-kicker rounded-[4px] px-3 py-1 text-muted-foreground">
                {locale === "zh" ? "Search Cluster" : "Search Cluster"}
              </span>
            </div>
            <h1 className="public-display mt-4 max-w-5xl text-5xl text-foreground lg:text-6xl">{copy.title}</h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-foreground">{copy.description}</p>
          </div>

          <aside className="public-panel rounded-[12px] p-6">
            <p className="public-kicker text-muted-foreground">{copy.directoryTitle}</p>
            <p className="mt-3 text-base leading-7 text-foreground">{copy.directoryDescription}</p>
            <div className="mt-6 space-y-3">
              {copy.proofPoints.map((point) => (
                <div key={point} className="flex gap-2 text-sm leading-6 text-muted-foreground">
                  <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-secondary" />
                  <span>{point}</span>
                </div>
              ))}
            </div>
          </aside>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-8">
        <div className="public-panel rounded-[12px] p-6 sm:p-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <p className="public-kicker text-muted-foreground">{copy.eyebrow}</p>
              <h2 className="mt-3 font-display text-3xl font-extrabold uppercase tracking-[0.02em] text-foreground">
                {copy.featuredTitle}
              </h2>
              <p className="mt-4 text-base leading-8 text-muted-foreground">{copy.featuredDescription}</p>
            </div>
            <Button className="public-button-primary h-11 px-5" asChild>
              <Link href={featuredHref}>
                {copy.featuredCta}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-18">
        <div className="grid gap-px overflow-hidden rounded-[12px] border border-border bg-border lg:grid-cols-2 xl:grid-cols-3">
          {resources.map((resource, index) => {
            const Icon = iconList[index] ?? Sparkles
            return (
              <Link
                key={resource.href}
                href={localizePublicPath(resource.href, locale)}
                className="group bg-card px-6 py-6 transition hover:bg-background"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="public-kicker text-muted-foreground">{resource.label}</div>
                  <div className="flex h-11 w-11 items-center justify-center rounded-[6px] border border-primary/30 bg-primary/95">
                    <Icon className="h-5 w-5 text-primary-foreground" />
                  </div>
                </div>
                <h2 className="mt-6 font-display text-3xl font-extrabold uppercase tracking-[0.02em] text-foreground">
                  {resource.title}
                </h2>
                <p className="mt-3 text-sm leading-7 text-muted-foreground">{resource.description}</p>
                <div className="mt-5 font-display text-xs font-bold uppercase tracking-[0.16em] text-foreground/58 group-hover:text-foreground">
                  {locale === "zh" ? "打开资源" : "Open resource"}
                </div>
              </Link>
            )
          })}
        </div>
      </section>

      <PublicSiteFooter />
    </main>
  )
}

async function getPlatformDirectoryCopy(locale: AppLocale, page: PlatformDirectoryPage) {
  const currentUser = await getServerSessionUser().catch(() => null)
  const capabilityExecutionMap = new Map(
    (await listPlatformCapabilityExecutionStates(locale, currentUser)).map((item) => [item.capabilitySlug, item] as const),
  )
  const heading = getPlatformDirectoryHeadingCopy(locale, page)

  switch (page) {
    case "agents":
      return {
        ...heading,
        items: (await listPlatformRegistryEntryExecutionStates({
          locale,
          itemType: "agent",
          surface: "public",
          enterpriseId: currentUser?.enterpriseId,
          currentUser,
        })).map((item) => ({
          ...item,
          launchItemType: "agent" as const,
          detailHref: `/agents/${item.slug}`,
          extraLabel: item.label,
          proofPoints: item.notes.slice(0, 4),
        })),
      }
    case "capabilities":
      return {
        ...heading,
        items: (await listPlatformRegistryEntryExecutionStates({
          locale,
          itemType: "capability",
          surface: "public",
          enterpriseId: currentUser?.enterpriseId,
          currentUser,
        })).map((item) => ({
          ...item,
          launchItemType: "capability" as const,
          detailHref: `/capabilities/${item.slug}`,
          proofPoints: item.notes.slice(0, 4),
          extraLabel: capabilityExecutionMap.has(item.slug)
            ? getCapabilityExecutionLabel(
                locale,
                capabilityExecutionMap.get(item.slug)!.runtimeStatus,
                capabilityExecutionMap.get(item.slug)!.accessState,
              )
            : item.bindingTarget.toUpperCase(),
        })),
      }
    case "plugins":
      return {
        ...heading,
        items: (await listPlatformRegistryEntryExecutionStates({
          locale,
          itemType: "plugin",
          surface: "public",
          enterpriseId: currentUser?.enterpriseId,
          currentUser,
        })).map((item) => ({
          ...item,
          launchItemType: "plugin" as const,
          detailHref: `/plugins/${item.slug}`,
          extraLabel: item.label,
          proofPoints: item.notes.slice(0, 4),
        })),
      }
    case "mcp-services":
      return {
        ...heading,
        items: (await listPlatformRegistryEntryExecutionStates({
          locale,
          itemType: "mcp_service",
          surface: "public",
          enterpriseId: currentUser?.enterpriseId,
          currentUser,
        })).map((item) => ({
          ...item,
          launchItemType: "mcp_service" as const,
          detailHref: `/mcp-services/${item.slug}`,
          extraLabel: item.label,
          proofPoints: item.notes.slice(0, 4),
        })),
      }
    case "workflows":
      return {
        ...heading,
        items: (await listPlatformRegistryEntryExecutionStates({
          locale,
          itemType: "workflow",
          surface: "public",
          enterpriseId: currentUser?.enterpriseId,
          currentUser,
        })).map((item) => ({
          ...item,
          launchItemType: "workflow" as const,
          detailHref: `/workflows/${item.slug}`,
          extraLabel: item.label,
          proofPoints: item.notes.slice(0, 4),
        })),
      }
  }
}

export function getPlatformDirectoryMetadata(locale: AppLocale, page: PlatformDirectoryPage): Metadata {
  const copy = getPlatformDirectoryHeadingCopy(locale, page)
  const canonical = buildLocalizedPublicUrl(`/${page}`, locale)

  return {
    title: copy.title,
    description: copy.description,
    alternates: {
      canonical,
      languages: getLocalizedPublicAlternates(`/${page}`),
    },
    openGraph: {
      title: copy.title,
      description: copy.description,
      url: canonical,
      siteName: "AIMarketingSite",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: copy.title,
      description: copy.description,
    },
  }
}

export async function renderPlatformDirectoryPage(locale: AppLocale, page: PlatformDirectoryPage) {
  const copy = await getPlatformDirectoryCopy(locale, page)
  const displayLocale = locale === "zh" ? "zh" : "en"

  return (
    <main className="min-h-screen bg-background text-foreground">
      <PublicSiteHeader activeKey="tools" />
      <PublicPlatformDirectory
        locale={displayLocale}
        eyebrow="Platform Core"
        title={copy.title}
        description={copy.description}
        items={copy.items}
      />
      <PublicSiteFooter />
    </main>
  )
}

export function getUseCaseStaticParams() {
  return getLocalizedSeoStaticParams("use-cases")
}

export function getAlternativeStaticParams() {
  return getLocalizedSeoStaticParams("alternatives")
}

export function getAlternativeMetadata(locale: AppLocale, slug: string) {
  return getLocalizedSeoMetadata(locale, "alternatives", slug)
}

export function renderAlternativePage(locale: AppLocale, slug: string) {
  return renderLocalizedSeoPage(locale, "alternatives", slug)
}

export function getAgentStaticParams() {
  return getLocalizedSeoStaticParams("agents")
}

export function getAgentMetadata(locale: AppLocale, slug: string) {
  return getLocalizedSeoMetadata(locale, "agents", slug)
}

export function renderAgentPage(locale: AppLocale, slug: string) {
  return renderLocalizedSeoPage(locale, "agents", slug)
}

export function getUseCaseMetadata(locale: AppLocale, slug: string) {
  return getLocalizedSeoMetadata(locale, "use-cases", slug)
}

export function renderUseCasePage(locale: AppLocale, slug: string) {
  return renderLocalizedSeoPage(locale, "use-cases", slug)
}

export function getCompareStaticParams() {
  return getLocalizedSeoStaticParams("compare")
}

export function getCompareMetadata(locale: AppLocale, slug: string) {
  return getLocalizedSeoMetadata(locale, "compare", slug)
}

export function renderComparePage(locale: AppLocale, slug: string) {
  return renderLocalizedSeoPage(locale, "compare", slug)
}

export function getResourceStaticParams() {
  return getLocalizedSeoStaticParams("resources")
}

export function getResourceMetadata(locale: AppLocale, slug: string) {
  return getLocalizedSeoMetadata(locale, "resources", slug)
}

export function renderResourcePage(locale: AppLocale, slug: string) {
  return renderLocalizedSeoPage(locale, "resources", slug)
}

export function getPromptStaticParams() {
  return getLocalizedSeoStaticParams("prompts")
}

export function getPromptMetadata(locale: AppLocale, slug: string) {
  return getLocalizedSeoMetadata(locale, "prompts", slug)
}

export function renderPromptPage(locale: AppLocale, slug: string) {
  return renderLocalizedSeoPage(locale, "prompts", slug)
}

export function getAiCostMetadata(locale: AppLocale): Metadata {
  const copy = getAiCostPageCopy(locale)
  const canonical = buildLocalizedPublicUrl("/resources/ai-subscription-cost-calculator", locale)
  const title = locale === "zh" ? "对比营销团队的 AI 工具成本" : "Compare AI Tool Costs for Marketing Teams"

  return {
    title,
    description: copy.description,
    alternates: {
      canonical,
      languages: getLocalizedPublicAlternates("/resources/ai-subscription-cost-calculator"),
    },
    openGraph: {
      title,
      description: copy.description,
      url: canonical,
      siteName: "AIMarketingSite",
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: copy.description,
    },
  }
}

export function renderAiCostPage(locale: AppLocale) {
  const copy = getAiCostPageCopy(locale)
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: locale === "zh" ? "AI 工具成本计算器" : "AI Subscription Cost Calculator",
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: copy.description,
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <PublicSiteHeader activeKey="resources" />

      <section className="public-grid-bg mx-auto max-w-7xl px-6 py-16 lg:py-20">
        <div className="flex flex-wrap items-center gap-2">
          <p className="public-kicker text-muted-foreground">{copy.eyebrow}</p>
          <span className="public-system-chip public-kicker rounded-[4px] px-3 py-1 text-muted-foreground">
            {copy.budgetSignal}
          </span>
          <span className="inline-flex items-center gap-2 rounded-[4px] border border-border px-3 py-1">
            <span className="public-signal" aria-hidden="true" />
            <span className="public-kicker text-muted-foreground">{copy.teamCostScan}</span>
          </span>
        </div>
        <h1 className="public-display mt-4 max-w-4xl text-5xl text-foreground lg:text-6xl">
          {copy.title}
        </h1>
        <p className="mt-6 max-w-3xl text-lg leading-8 text-muted-foreground">
          {copy.description}
        </p>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-18">
        <AiCostCalculator locale={locale} />
      </section>

      <PublicSiteFooter />
    </main>
  )
}
