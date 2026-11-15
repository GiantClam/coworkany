"use client"

import type React from "react"
import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import dynamic from "next/dynamic"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import * as DropdownMenu from "@radix-ui/react-dropdown-menu"
import {
  Bot,
  CreditCard,
  Database,
  Globe,
  GraduationCap,
  House,
  ImageIcon,
  LayoutGrid,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  PenSquare,
  Presentation,
  Radar,
  Search,
  Settings,
  Scale,
  ShieldCheck,
  Target,
  TrendingUp,
  Users,
  UserPlus,
  Video,
  Workflow,
  X,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import { useAuth } from "@/components/auth-provider"
import { AiEntrySidebarItem } from "@/components/ai-entry/AiEntrySidebarItem"
import { AdvisorSidebarItem } from "@/components/chat/AdvisorSidebarItem"
import {
  DashboardAvailabilityProvider,
  useDashboardAvailability,
} from "@/components/dashboard-availability-provider"
import { ImageAssistantSidebarItem } from "@/components/image-assistant/ImageAssistantSidebarItem"
import { useI18n } from "@/components/locale-provider"
import { LocaleSwitcher } from "@/components/locale-switcher"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { WriterSidebarItem } from "@/components/writer/WriterSidebarItem"
import { BUSINESS_MARKETPLACE_SELECTION_UPDATED_EVENT } from "@/lib/platform/business-marketplace-events"
import {
  listLocalizedBusinessAgentConfigsBySlug,
  type LocalizedBusinessAgentConfig,
} from "@/lib/platform/business-agents"
import { buildBusinessSidebarItems } from "@/lib/platform/business-sidebar"
import {
  getLocalizedWorkspaceBusinessEntries,
  resolveWorkspaceBusinessSlug,
  type LocalizedWorkspaceBusinessEntry,
} from "@/lib/platform/workspace-business"
import { cn } from "@/lib/utils"
import { WORKBENCH_ROUTE_MANIFEST, WorkbenchRouteIcon, WorkbenchShellFrame } from "@coworkany/workbench-ui"

function sharedRouteLabel(path: string, locale: "zh" | "en") {
  const route = WORKBENCH_ROUTE_MANIFEST.find((item) => item.path === path)
  return route ? route.label[locale] : path
}

// Client-only: page-agent touches window/document, so never SSR it.
const PageAgentWidget = dynamic(
  () => import("@/components/page-agent/page-agent-widget").then((m) => m.PageAgentWidget),
  { ssr: false },
)

interface DashboardLayoutProps {
  children: React.ReactNode
}

const businessIconMap = {
  content: TrendingUp,
  creative: ImageIcon,
  lead: Radar,
  sales: Target,
  operations: Workflow,
  knowledge: Database,
  compliance: ShieldCheck,
  training: GraduationCap,
  talent: UserPlus,
  legal: Scale,
} satisfies Record<string, LucideIcon>

export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <DashboardAvailabilityProvider>
      <DashboardLayoutContent>{children}</DashboardLayoutContent>
    </DashboardAvailabilityProvider>
  )
}

function DashboardLayoutContent({ children }: DashboardLayoutProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { messages, locale } = useI18n()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const { user, isDemoMode, loading, logout, hasFeature } = useAuth()
  const { advisor, writer, imageAssistant } = useDashboardAvailability()
  const [isLoggingOut, setIsLoggingOut] = useState(false)
  const usesImmersiveCanvas =
    pathname.startsWith("/dashboard/ai") ||
    pathname.startsWith("/dashboard/writer") ||
    pathname.startsWith("/dashboard/image-assistant") ||
    pathname.startsWith("/dashboard/video") ||
    pathname.startsWith("/dashboard/business") ||
    pathname.startsWith("/dashboard/advisor")

  useEffect(() => {
    if (!loading && !user) {
      const currentPath = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`
      router.replace(`/login?next=${encodeURIComponent(currentPath)}`)
    }
  }, [loading, pathname, router, searchParams, user])

  const handleLogout = async () => {
    setIsLoggingOut(true)
    try {
      await logout()
      setSidebarOpen(false)
      router.replace("/login")
    } finally {
      setIsLoggingOut(false)
    }
  }

  const userEmail = user?.email || ""
  const hasAdvisorFeature = hasFeature("expert_advisor")
  const hasLeadHunterFeature = hasFeature("customer_profile_entry")
  const hasWebsiteFeature = hasFeature("website_generation")
  const hasVideoFeature = hasFeature("video_generation")
  const hasCopywritingFeature = hasFeature("copywriting_generation")
  const hasImageAssistantFeature = hasFeature("image_design_generation")
  const enterprisePending = user?.enterpriseStatus === "pending"
  const enterpriseRejected = user?.enterpriseStatus === "rejected"

  const showAdvisorSection = useMemo(() => {
    if (enterprisePending || enterpriseRejected) return false
    return hasAdvisorFeature && (advisor.brandStrategy || advisor.growth)
  }, [advisor, enterprisePending, enterpriseRejected, hasAdvisorFeature])

  const showLeadHunterSection = useMemo(() => {
    if (enterprisePending || enterpriseRejected) return false
    return (hasLeadHunterFeature && advisor.leadHunter) || (hasAdvisorFeature && (advisor.companySearch || advisor.contactMining))
  }, [advisor, enterprisePending, enterpriseRejected, hasAdvisorFeature, hasLeadHunterFeature])

  const showWriterEntry = useMemo(() => {
    if (enterprisePending || enterpriseRejected) return false
    return hasCopywritingFeature && writer.enabled
  }, [enterprisePending, enterpriseRejected, hasCopywritingFeature, writer.enabled])

  const showPptAssistantEntry = useMemo(() => {
    if (enterprisePending || enterpriseRejected) return false
    return hasAdvisorFeature
  }, [enterprisePending, enterpriseRejected, hasAdvisorFeature])

  const showImageAssistantEntry = useMemo(() => {
    if (enterprisePending || enterpriseRejected) return false
    return hasImageAssistantFeature && imageAssistant.enabled
  }, [enterprisePending, enterpriseRejected, hasImageAssistantFeature, imageAssistant.enabled])

  const showAiEntry = useMemo(() => {
    return true
  }, [])

  const aiEntryLabel = sharedRouteLabel("/dashboard/ai", locale)
  const consultingAdvisorLabel = sharedRouteLabel("/dashboard/ai?entry=consulting-advisor", locale)
  const consultingAdvisorHref = "/dashboard/ai?entry=consulting-advisor"
  // Brand/Growth advisors are served by the AI Entry skill chain (DeepSeek V4 Pro),
  // not the Dify workflow. Lock the model via entry=consulting-advisor.
  const brandAdvisorHref = "/dashboard/ai?agent=executive-brand&entry=consulting-advisor"
  const growthAdvisorHref = "/dashboard/ai?agent=executive-growth&entry=consulting-advisor"
  const pptAssistantHref = "/dashboard/ai?agent=executive-ppt"
  const presentationPptAssistantHref = "/dashboard/ai?agent=executive-presentation-ppt"
  const businessSectionLabel = locale === "zh" ? "业务入口" : "Business"
  const currentBusinessAgentId = (searchParams.get("agent") || "").trim()
  const requestedBusinessView = searchParams.get("view")
  const [selectedMarketplaceEntries, setSelectedMarketplaceEntries] = useState<LocalizedWorkspaceBusinessEntry[]>([])
  const [selectedMarketplaceAgents, setSelectedMarketplaceAgents] = useState<LocalizedBusinessAgentConfig[]>([])
  const selectedMarketplaceAgentIdSet = useMemo(
    () => new Set(selectedMarketplaceAgents.map((agent) => agent.agentId)),
    [selectedMarketplaceAgents],
  )
  const localizedBusinessEntries = useMemo(
    () => {
      const displayLocale = locale === "zh" ? "zh" : "en"
      const coreEntries = getLocalizedWorkspaceBusinessEntries(locale)
      const importedAgentMap = new Map(
        selectedMarketplaceAgents.map((agent) => [agent.agentId, agent]),
      )

      const importedEntries = selectedMarketplaceEntries
        .filter((entry) => !coreEntries.some((coreEntry) => coreEntry.slug === entry.slug))
        .map((entry) => ({
          ...entry,
          agents: selectedMarketplaceAgents.filter((agent) => agent.businessSlug === entry.slug),
        }))
        .filter((entry) => entry.agents.length > 0)

      return [
        ...coreEntries.map((entry) => ({
          ...entry,
          agents: [
            ...listLocalizedBusinessAgentConfigsBySlug(displayLocale, entry.slug),
            ...selectedMarketplaceAgents.filter((agent) => agent.businessSlug === entry.slug),
          ].filter((agent, index, collection) => collection.findIndex((item) => item.agentId === agent.agentId) === index),
        })),
        ...importedEntries,
      ].map((entry) => ({
        ...entry,
        agents: entry.agents
          .map((agent) => importedAgentMap.get(agent.agentId) || agent)
          .filter((agent, index, collection) => collection.findIndex((item) => item.agentId === agent.agentId) === index),
      }))
    },
    [locale, selectedMarketplaceAgents, selectedMarketplaceEntries],
  )

  useEffect(() => {
    let cancelled = false

    const loadMarketplaceSelection = async () => {
      try {
        const params = new URLSearchParams({
          locale: locale === "zh" ? "zh" : "en",
        })
        const response = await fetch(`/api/platform/business/marketplace-selection?${params.toString()}`, {
          cache: "no-store",
          credentials: "same-origin",
        })
        const payload = (await response.json().catch(() => null)) as
          | {
              data?: {
                selectedAgents?: LocalizedBusinessAgentConfig[]
                selectedEntries?: LocalizedWorkspaceBusinessEntry[]
              }
            }
          | null
        if (cancelled || !response.ok) return

        setSelectedMarketplaceAgents(Array.isArray(payload?.data?.selectedAgents) ? payload.data.selectedAgents : [])
        setSelectedMarketplaceEntries(Array.isArray(payload?.data?.selectedEntries) ? payload.data.selectedEntries : [])
      } catch {
        if (cancelled) return
        setSelectedMarketplaceAgents([])
        setSelectedMarketplaceEntries([])
      }
    }

    const handleMarketplaceSelectionUpdated = () => {
      void loadMarketplaceSelection()
    }

    void loadMarketplaceSelection()
    window.addEventListener(BUSINESS_MARKETPLACE_SELECTION_UPDATED_EVENT, handleMarketplaceSelectionUpdated)
    return () => {
      cancelled = true
      window.removeEventListener(BUSINESS_MARKETPLACE_SELECTION_UPDATED_EVENT, handleMarketplaceSelectionUpdated)
    }
  }, [locale])
  const currentBusinessView = useMemo(() => {
    const queryScopedEntry = localizedBusinessEntries.find((entry) => entry.slug === requestedBusinessView)
    if (queryScopedEntry) return queryScopedEntry.slug
    if (currentBusinessAgentId) {
      const agentScopedEntry = localizedBusinessEntries.find((entry) =>
        entry.agents.some((agent) => agent.agentId === currentBusinessAgentId),
      )
      if (agentScopedEntry) return agentScopedEntry.slug
    }
    return resolveWorkspaceBusinessSlug(null)
  }, [currentBusinessAgentId, localizedBusinessEntries, requestedBusinessView])
  const businessSidebarItems = useMemo(
    () =>
      buildBusinessSidebarItems({
        entries: localizedBusinessEntries,
        pathname,
        currentBusinessView,
        currentBusinessAgentId,
        selectedMarketplaceAgentIdSet,
      }),
    [
      currentBusinessAgentId,
      currentBusinessView,
      localizedBusinessEntries,
      pathname,
      selectedMarketplaceAgentIdSet,
    ],
  )
  const platformSectionLabel = locale === "zh" ? "\u5e73\u53f0\u4e2d\u53f0" : "Platform"
  const capabilityCenterLabel = locale === "zh" ? "\u80fd\u529b\u4e2d\u5fc3" : "Capabilities"
  const agentPlatformLabel = locale === "zh" ? "\u667a\u80fd\u4f53\u4e2d\u53f0" : "Agent Platform"
  const workflowsLabel = sharedRouteLabel("/dashboard/workflows", locale)
  const platformSettingsLabel = locale === "zh" ? "\u4f01\u4e1a\u8bbe\u7f6e" : "Enterprise Settings"
  const resourcesSectionLabel = locale === "zh" ? "资源入口" : "Resources"
  const taskCenterLabel = sharedRouteLabel("/dashboard/tasks", locale)
  const assetLibraryLabel = sharedRouteLabel("/dashboard/assets", locale)
  const knowledgeBaseLabel = sharedRouteLabel("/dashboard/knowledge-base", locale)
  const billingLabel = locale === "zh" ? "计费与用量" : "Billing and usage"

  const isSidebarLinkActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`)

  return (
    <WorkbenchShellFrame className="dashboard-shell flex h-screen bg-transparent">
      {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <aside
        className={`dashboard-panel !fixed inset-y-0 left-0 z-50 overflow-hidden border-r border-sidebar-border/50 bg-sidebar shadow-none transition-[width,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] lg:!static ${
          sidebarCollapsed ? "w-[88px]" : "w-[240px] lg:w-[276px]"
        } ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
      >
        <div className="flex h-full flex-col">
          <div className={sidebarCollapsed ? "border-b border-sidebar-border/55 p-3" : "border-b border-sidebar-border/55 p-4"}>
            <div className="flex flex-col gap-3">
                <div className={sidebarCollapsed ? "flex flex-col items-center gap-3" : "flex min-w-0 items-center gap-3"}>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[6px] border border-primary/40 bg-primary">
                  <span className="dashboard-title text-base text-primary-foreground">AI</span>
                </div>
                {!sidebarCollapsed && <span className="dashboard-title text-lg tracking-tight text-sidebar-foreground">MARKETING</span>}
              </div>
              <div className={sidebarCollapsed ? "flex w-full flex-col items-center gap-2" : "flex items-center gap-1"}>
                <LocaleSwitcher compact={sidebarCollapsed} className={sidebarCollapsed ? "w-full justify-center" : ""} />
                <Button
                  variant="ghost"
                  size="sm"
                  className={sidebarCollapsed ? "dashboard-chip hidden h-9 w-9 rounded-[4px] p-0 lg:inline-flex" : "dashboard-chip hidden rounded-[4px] lg:inline-flex"}
                  onClick={() => setSidebarCollapsed((current) => !current)}
                  title={sidebarCollapsed ? messages.shared.expandSidebar : messages.shared.collapseSidebar}
                  aria-label={sidebarCollapsed ? messages.shared.expandSidebar : messages.shared.collapseSidebar}
                >
                  {sidebarCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                </Button>
                <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setSidebarOpen(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            {!sidebarCollapsed && user?.enterpriseName && (
              <p className="dashboard-chip dashboard-kicker mt-3 rounded-[4px] px-3 py-1.5 text-sidebar-foreground/80">
                {user.enterpriseName} ({user.enterpriseCode})
              </p>
            )}
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <ScrollArea
              className="h-full"
              viewportClassName="overflow-x-hidden [&>div]:!block [&>div]:!w-full [&>div]:!min-w-0"
            >
              <div className={sidebarCollapsed ? "space-y-3 p-3" : "space-y-4 p-4"}>
                {(enterprisePending || enterpriseRejected) && (
                  <div className="rounded-[20px] border-2 border-amber-300 bg-amber-50 p-3 text-xs text-amber-700">
                    {enterprisePending ? messages.dashboardLayout.pendingEnterprise : messages.dashboardLayout.rejectedEnterprise}
                  </div>
                )}

                <DashboardMenuLink
                  href="/dashboard"
                  label={locale === "zh" ? "首页" : "Home"}
                  icon={House}
                  iconName="home"
                  collapsed={sidebarCollapsed}
                  active={pathname === "/dashboard"}
                />

                {showAiEntry && (
                  sidebarCollapsed ? (
                        <Link href="/dashboard/ai">
                          <Button
                            variant="ghost"
                            className="dashboard-chip w-full justify-center rounded-[4px] bg-card"
                            size="sm"
                            title={aiEntryLabel}
                            aria-label={aiEntryLabel}
                      >
                        <Bot className="h-4 w-4" />
                      </Button>
                    </Link>
                  ) : (
                    <AiEntrySidebarItem title={aiEntryLabel} icon={Bot} />
                  )
                )}

                {(showAdvisorSection || showPptAssistantEntry) && (
                  <div>
                    {!sidebarCollapsed && (
                      <h3 className="dashboard-kicker mb-2 text-sidebar-foreground/65">
                        {messages.dashboardLayout.advisorSection}
                      </h3>
                    )}
                    {hasAdvisorFeature &&
                      (sidebarCollapsed ? (
                        <Link href={consultingAdvisorHref}>
                          <Button
                            variant="ghost"
                            className="w-full justify-center"
                            size="sm"
                            title={consultingAdvisorLabel}
                          >
                            <Bot className="h-4 w-4" />
                          </Button>
                        </Link>
                      ) : (
                        <AiEntrySidebarItem
                          title={consultingAdvisorLabel}
                          icon={Bot}
                          entryHref={consultingAdvisorHref}
                        />
                      ))}
                    {hasAdvisorFeature && advisor.brandStrategy && userEmail && (
                      sidebarCollapsed ? (
                        <Link href={brandAdvisorHref}>
                          <Button variant="ghost" className="w-full justify-center" size="sm" title={messages.dashboardLayout.brandAdvisor}>
                            <Target className="h-4 w-4" />
                          </Button>
                        </Link>
                      ) : (
                        <AiEntrySidebarItem title={messages.dashboardLayout.brandAdvisor} icon={Target} entryHref={brandAdvisorHref} activeAgentId="executive-brand" />
                      )
                    )}
                    {hasAdvisorFeature && advisor.growth && userEmail && (
                      sidebarCollapsed ? (
                        <Link href={growthAdvisorHref}>
                          <Button variant="ghost" className="mt-1 w-full justify-center" size="sm" title={messages.dashboardLayout.growthAdvisor}>
                            <TrendingUp className="h-4 w-4" />
                          </Button>
                        </Link>
                      ) : (
                        <AiEntrySidebarItem title={messages.dashboardLayout.growthAdvisor} icon={TrendingUp} entryHref={growthAdvisorHref} activeAgentId="executive-growth" />
                      )
                    )}
                    {showPptAssistantEntry ? (
                      sidebarCollapsed ? (
                        <>
                          <Link href={pptAssistantHref}>
                            <Button
                              variant="ghost"
                              className="mt-1 w-full justify-center"
                              size="sm"
                              title={messages.dashboardLayout.pptAssistant}
                              aria-label={messages.dashboardLayout.pptAssistant}
                            >
                              <Presentation className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Link href={presentationPptAssistantHref}>
                            <Button
                              variant="ghost"
                              className="mt-1 w-full justify-center"
                              size="sm"
                              title={messages.dashboardLayout.presentationPptAssistant}
                              aria-label={messages.dashboardLayout.presentationPptAssistant}
                            >
                              <Presentation className="h-4 w-4" />
                            </Button>
                          </Link>
                        </>
                      ) : (
                        <>
                          <AiEntrySidebarItem
                            title={messages.dashboardLayout.pptAssistant}
                            icon={Presentation}
                            entryHref={pptAssistantHref}
                            activeAgentId="executive-ppt"
                          />
                          <AiEntrySidebarItem
                            title={messages.dashboardLayout.presentationPptAssistant}
                            icon={Presentation}
                            entryHref={presentationPptAssistantHref}
                            activeAgentId="executive-presentation-ppt"
                          />
                        </>
                      )
                    ) : null}
                  </div>
                )}

                {showLeadHunterSection && (
                  <div>
                    {!sidebarCollapsed && (
                      <h3 className="dashboard-kicker mb-2 text-sidebar-foreground/65">
                        {messages.dashboardLayout.leadHunterSection}
                      </h3>
                    )}
                    {hasAdvisorFeature && advisor.companySearch && userEmail && (
                      sidebarCollapsed ? (
                        <Link href="/dashboard/advisor/company-search/new">
                          <Button variant="ghost" className="w-full justify-center" size="sm" title={messages.dashboardLayout.companySearch}>
                            <Search className="h-4 w-4" />
                          </Button>
                        </Link>
                      ) : (
                        <AdvisorSidebarItem title={messages.dashboardLayout.companySearch} advisorType="company-search" userEmail={userEmail} icon={Search} />
                      )
                    )}
                    {hasLeadHunterFeature && advisor.leadHunter && userEmail && (
                      sidebarCollapsed ? (
                        <Link href="/dashboard/advisor/lead-hunter/new">
                          <Button
                            variant="ghost"
                            className={hasAdvisorFeature && advisor.companySearch ? "mt-1 w-full justify-center" : "w-full justify-center"}
                            size="sm"
                            title={messages.dashboardLayout.leadHunter}
                          >
                            <Radar className="h-4 w-4" />
                          </Button>
                        </Link>
                      ) : (
                        <AdvisorSidebarItem title={messages.dashboardLayout.leadHunter} advisorType="lead-hunter" userEmail={userEmail} icon={Radar} />
                      )
                    )}
                    {hasAdvisorFeature && advisor.contactMining && userEmail && (
                      sidebarCollapsed ? (
                        <Link href="/dashboard/advisor/contact-mining/new">
                          <Button
                            variant="ghost"
                            className={
                              (hasAdvisorFeature && advisor.companySearch) || (hasLeadHunterFeature && advisor.leadHunter)
                                ? "mt-1 w-full justify-center"
                                : "w-full justify-center"
                            }
                            size="sm"
                            title={messages.dashboardLayout.contactMining}
                          >
                            <Users className="h-4 w-4" />
                          </Button>
                        </Link>
                      ) : (
                        <AdvisorSidebarItem title={messages.dashboardLayout.contactMining} advisorType="contact-mining" userEmail={userEmail} icon={Users} />
                      )
                    )}
                  </div>
                )}

                {(showWriterEntry || showImageAssistantEntry) && (
                  <div>
                    {!sidebarCollapsed && (
                      <h3 className="dashboard-kicker mb-2 text-sidebar-foreground/65">
                        {messages.dashboardLayout.creativeSection}
                      </h3>
                    )}
                    {showWriterEntry ? (
                      sidebarCollapsed ? (
                        <Link href="/dashboard/writer">
                          <Button variant="ghost" className="w-full justify-center" size="sm" title={messages.dashboardLayout.writer} aria-label={messages.dashboardLayout.writer}>
                            <PenSquare className="h-4 w-4" />
                          </Button>
                        </Link>
                      ) : (
                        <WriterSidebarItem title={messages.dashboardLayout.writer} icon={PenSquare} />
                      )
                    ) : null}
                    {showImageAssistantEntry ? (
                      sidebarCollapsed ? (
                        <Link href="/dashboard/image-assistant">
                          <Button
                            variant="ghost"
                            className={showWriterEntry ? "mt-1 w-full justify-center" : "w-full justify-center"}
                            size="sm"
                            title={messages.dashboardLayout.imageAssistant}
                            aria-label={messages.dashboardLayout.imageAssistant}
                          >
                            <ImageIcon className="h-4 w-4" />
                          </Button>
                        </Link>
                      ) : (
                        <ImageAssistantSidebarItem title={messages.dashboardLayout.imageAssistant} icon={ImageIcon} />
                      )
                    ) : null}
                  </div>
                )}

                <div>
                  {!sidebarCollapsed && (
                    <h3 className="dashboard-kicker mb-2 text-sidebar-foreground/65">{businessSectionLabel}</h3>
                  )}
                  <div className="space-y-1">
                    {localizedBusinessEntries.map((entry) => {
                      const sidebarItem = businessSidebarItems.find((item) => item.slug === entry.slug)
                      if (!sidebarItem) return null
                      const BusinessIcon = businessIconMap[entry.iconKey]
                      return (
                        <div key={entry.slug} className="space-y-1">
                          <DashboardMenuLink
                            href={sidebarItem.href}
                            label={entry.title}
                            icon={BusinessIcon}
                            collapsed={sidebarCollapsed}
                            active={sidebarItem.active}
                            highlighted={sidebarItem.highlighted}
                          />
                          {!sidebarCollapsed && sidebarItem.visibleAgents.length > 0 ? (
                            <div className="ml-3 space-y-1 border-l border-sidebar-border/35 pl-3">
                              {sidebarItem.visibleAgents.map((agent) => {
                                return (
                                  <DashboardSubMenuLink
                                    key={agent.agentId}
                                    href={agent.href}
                                    label={agent.name}
                                    active={agent.active}
                                    highlighted={agent.highlighted}
                                    onClick={() => {
                                      const existingTab = Array.from(
                                        document.querySelectorAll<HTMLElement>('[role="tab"][data-agent-id]'),
                                      ).find((tab) => tab.dataset.agentId === agent.agentId)
                                      if (!existingTab) return false
                                      existingTab.click()
                                      setSidebarOpen(false)
                                      return true
                                    }}
                                  />
                                )
                              })}
                            </div>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div>
                  {!sidebarCollapsed && (
                    <h3 className="dashboard-kicker mb-2 text-sidebar-foreground/65">{platformSectionLabel}</h3>
                  )}
                  {sidebarCollapsed ? (
                    <div className="space-y-1">
                      <DashboardMenuLink href="/dashboard/capabilities" label={capabilityCenterLabel} icon={LayoutGrid} iconName="capability" collapsed active={isSidebarLinkActive("/dashboard/capabilities")} />
                      <DashboardMenuLink href="/dashboard/agent-platform" label={agentPlatformLabel} icon={Bot} collapsed active={isSidebarLinkActive("/dashboard/agent-platform")} />
                      <DashboardMenuLink href="/dashboard/workflows" label={workflowsLabel} icon={Workflow} iconName="workflow" collapsed active={isSidebarLinkActive("/dashboard/workflows")} />
                      <DashboardMenuLink href="/dashboard/platform-settings" label={platformSettingsLabel} icon={Settings} iconName="settings" collapsed active={isSidebarLinkActive("/dashboard/platform-settings")} />
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <DashboardMenuLink href="/dashboard/capabilities" label={capabilityCenterLabel} icon={LayoutGrid} iconName="capability" collapsed={false} active={isSidebarLinkActive("/dashboard/capabilities")} />
                      <DashboardMenuLink href="/dashboard/agent-platform" label={agentPlatformLabel} icon={Bot} collapsed={false} active={isSidebarLinkActive("/dashboard/agent-platform")} />
                      <DashboardMenuLink href="/dashboard/workflows" label={workflowsLabel} icon={Workflow} iconName="workflow" collapsed={false} active={isSidebarLinkActive("/dashboard/workflows")} />
                      <DashboardMenuLink href="/dashboard/platform-settings" label={platformSettingsLabel} icon={Settings} iconName="settings" collapsed={false} active={isSidebarLinkActive("/dashboard/platform-settings")} />
                    </div>
                  )}
                </div>

                <div>
                  {!sidebarCollapsed && (
                    <h3 className="dashboard-kicker mb-2 text-sidebar-foreground/65">{resourcesSectionLabel}</h3>
                  )}
                  <div className="space-y-1">
                    <DashboardMenuLink href="/dashboard/tasks" label={taskCenterLabel} icon={Workflow} iconName="task" collapsed={sidebarCollapsed} active={isSidebarLinkActive("/dashboard/tasks")} />
                    <DashboardMenuLink href="/dashboard/assets" label={assetLibraryLabel} icon={ImageIcon} iconName="asset" collapsed={sidebarCollapsed} active={isSidebarLinkActive("/dashboard/assets")} />
                    <DashboardMenuLink href="/dashboard/knowledge-base" label={knowledgeBaseLabel} icon={Database} iconName="knowledge" collapsed={sidebarCollapsed} active={isSidebarLinkActive("/dashboard/knowledge-base")} />
                    <DashboardMenuLink href="/dashboard/billing" label={billingLabel} icon={CreditCard} collapsed={sidebarCollapsed} active={isSidebarLinkActive("/dashboard/billing")} />
                  </div>
                </div>
              </div>
            </ScrollArea>
          </div>

          <div className={sidebarCollapsed ? "space-y-2 border-t border-sidebar-border/45 p-3" : "space-y-2 border-t border-sidebar-border/45 p-4"}>
            {hasVideoFeature && !enterprisePending && !enterpriseRejected && (
              <Link href="/dashboard/video">
                <Button
                  variant="ghost"
                  className={
                    sidebarCollapsed
                      ? "dashboard-chip w-full justify-center rounded-[4px] bg-white/40"
                      : "dashboard-chip dashboard-kicker h-11 w-full justify-start rounded-[4px] bg-card text-sidebar-foreground hover:bg-primary hover:text-primary-foreground"
                  }
                  size="sm"
                  title={messages.dashboardLayout.videoAgent}
                >
                  <Video className={sidebarCollapsed ? "h-4 w-4" : "mr-2 h-4 w-4"} />
                  {!sidebarCollapsed && messages.dashboardLayout.videoAgent}
                </Button>
              </Link>
            )}
            {hasWebsiteFeature && !enterprisePending && !enterpriseRejected && (
              <Link href="/dashboard/website-generator">
                <Button
                  variant="ghost"
                  className={
                    sidebarCollapsed
                      ? "dashboard-chip w-full justify-center rounded-[4px] bg-white/40"
                      : "dashboard-chip dashboard-kicker h-11 w-full justify-start rounded-[4px] bg-card text-sidebar-foreground hover:bg-primary hover:text-primary-foreground"
                  }
                  size="sm"
                  title={messages.dashboardLayout.websiteAgent}
                >
                  <Globe className={sidebarCollapsed ? "h-4 w-4" : "mr-2 h-4 w-4"} />
                  {!sidebarCollapsed && messages.dashboardLayout.websiteAgent}
                </Button>
              </Link>
            )}
            <Separator className="my-2" />

            <div className={sidebarCollapsed ? "flex flex-col items-center gap-2" : "flex items-center gap-2"}>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    className={
                      sidebarCollapsed
                        ? "dashboard-chip flex w-full items-center justify-center rounded-[4px] bg-card p-2 transition-colors hover:bg-primary hover:text-primary-foreground"
                        : "dashboard-chip flex min-w-0 flex-1 items-center gap-3 rounded-[4px] bg-card p-3 text-left transition-colors hover:bg-primary hover:text-primary-foreground"
                    }
                    title={messages.shared.userSettings}
                    aria-label={messages.shared.userSettings}
                  >
                    <Avatar className="h-8 w-8">
                      <AvatarImage src="/placeholder.svg?height=32&width=32" />
                      <AvatarFallback className="bg-accent text-xs text-primary">
                        {isDemoMode ? messages.dashboardLayout.demoLabel : messages.shared.user}
                      </AvatarFallback>
                    </Avatar>
                    {!sidebarCollapsed && (
                      <>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {isDemoMode ? messages.shared.demoAccount : user?.name || messages.shared.marketingMember}
                          </p>
                          <p className="truncate text-xs text-muted-foreground group-hover:text-primary-foreground/80">{userEmail}</p>
                        </div>
                        <Settings className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </>
                    )}
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    sideOffset={8}
                    align={sidebarCollapsed ? "center" : "start"}
                    className="z-50 min-w-[180px] rounded-[8px] border border-sidebar-border bg-card p-1 shadow-lg outline-none"
                  >
                    <DropdownMenu.Item asChild>
                      <Link
                        href="/dashboard/billing"
                        className="flex items-center gap-2 rounded-[6px] px-3 py-2 text-sm text-sidebar-foreground outline-none transition hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground"
                      >
                        <CreditCard className="h-4 w-4" />
                        {messages.billing.navLabel}
                      </Link>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item asChild>
                      <Link
                        href="/dashboard/settings"
                        className="flex items-center gap-2 rounded-[6px] px-3 py-2 text-sm text-sidebar-foreground outline-none transition hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground"
                      >
                        <Settings className="h-4 w-4" />
                        {messages.shared.userSettings}
                      </Link>
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="my-1 h-px bg-sidebar-border" />
                    <DropdownMenu.Item
                      onSelect={() => void handleLogout()}
                      disabled={isLoggingOut}
                      className="flex items-center gap-2 rounded-[6px] px-3 py-2 text-sm text-sidebar-foreground outline-none transition hover:bg-primary hover:text-primary-foreground focus:bg-primary focus:text-primary-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
                    >
                      <LogOut className="h-4 w-4" />
                      {messages.shared.logout}
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-transparent">
        <header className="dashboard-panel border-b border-border bg-card p-4 lg:hidden">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-[4px] border border-primary/35 bg-primary">
                <span className="dashboard-title text-xs text-primary-foreground">AI</span>
              </div>
              <h1 className="dashboard-title text-lg text-foreground">{messages.shared.appName}</h1>
            </div>
          </div>
        </header>

        <div
          className={cn(
            "flex-1 bg-transparent",
            usesImmersiveCanvas ? "overflow-hidden" : "overflow-y-auto overflow-x-hidden",
          )}
        >
          {children}
        </div>
      </main>

      {user && !loading ? <PageAgentWidget /> : null}
    </WorkbenchShellFrame>
  )
}

function DashboardMenuLink({
  href,
  label,
  icon: Icon,
  iconName,
  collapsed,
  active,
  highlighted,
}: {
  href: string
  label: string
  icon: LucideIcon
  iconName?: string
  collapsed: boolean
  active: boolean
  highlighted?: boolean
}) {
  return (
    <Button
      asChild
      variant="ghost"
      className={cn(
        "box-border h-11 w-full min-w-0 rounded-[8px] border border-sidebar-border/35 bg-card/75 px-3 text-sidebar-foreground shadow-none transition hover:border-primary/40 hover:bg-primary hover:text-primary-foreground",
        collapsed ? "justify-center" : "justify-start",
        active &&
          "border-foreground/10 bg-foreground text-primary hover:border-foreground/10 hover:bg-foreground hover:text-primary",
        highlighted && !active && "border-primary/35 bg-primary/10",
      )}
      size="sm"
      title={label}
      aria-label={label}
    >
      {/* asChild merges the button styles onto the <a> so there is no nested
          <button> inside the link — clicking the anchor navigates directly,
          which is what page-agent (and real clicks) expect. */}
      <Link href={href} data-agent-nav={label}>
        {iconName ? <WorkbenchRouteIcon name={iconName} size={16} className={collapsed ? "" : "mr-2"} /> : <Icon className={collapsed ? "h-4 w-4" : "mr-2 h-4 w-4"} />}
        {!collapsed && label}
      </Link>
    </Button>
  )
}

function DashboardSubMenuLink({
  href,
  label,
  active,
  highlighted,
  onClick,
}: {
  href: string
  label: string
  active: boolean
  highlighted?: boolean
  onClick?: () => boolean
}) {
  return (
    <Link
      href={href}
      data-agent-nav={label}
      onClick={(event) => {
        if (onClick?.()) event.preventDefault()
      }}
      className={cn(
        "block rounded-[8px] border border-transparent px-3 py-2 text-xs text-sidebar-foreground/80 transition hover:border-primary/30 hover:bg-primary/10 hover:text-sidebar-foreground",
        active && "border-foreground/10 bg-foreground text-primary",
        highlighted && !active && "border-primary/30 bg-primary/10 text-sidebar-foreground",
      )}
    >
      {label}
    </Link>
  )
}
