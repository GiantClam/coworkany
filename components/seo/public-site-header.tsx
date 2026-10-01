"use client"

import Link from "next/link"
import Image from "next/image"
import { ChevronDown } from "lucide-react"

import { useI18n } from "@/components/locale-provider"
import { LocaleSwitcher } from "@/components/locale-switcher"
import { TrackedCtaLink } from "@/components/seo/tracked-cta-link"
import { Button } from "@/components/ui/button"
import { getPublicCopy } from "@/lib/i18n/public-copy"
import { localizePublicPath } from "@/lib/i18n/routing"
import { getLocalizedLeadToolsCatalog } from "@/lib/lead-tools/catalog"
import { getLocalizedPlatformHubLinks } from "@/lib/platform/catalog"
import { getPlatformDirectoryAvailability } from "@/lib/platform/directory-config"
import { SEO_EVENT } from "@/lib/seo/analytics"
import { cn } from "@/lib/utils"

type PublicNavKey = "alternatives" | "compare" | "solutions" | "resources" | "pricing" | "tools"

export function PublicSiteHeader({ activeKey }: { activeKey?: PublicNavKey }) {
  const { locale } = useI18n()
  const copy = getPublicCopy(locale)
  const homeHref = localizePublicPath("/", locale)
  const toolMenuLabels =
    locale === "zh"
      ? {
          tools: "工具",
          platform: "平台入口",
          allTools: "查看全部工具",
        }
      : {
          tools: "Tools",
          platform: "Platform",
          allTools: "View all tools",
        }
  const liveTools = getLocalizedLeadToolsCatalog(locale).filter(
    (tool) =>
      getPlatformDirectoryAvailability("tool", tool.slug, {
        status: tool.status === "live" ? "live_tool" : "coming_soon_tool",
        surface: "public",
      }) === "available",
  )
  const platformLinks = getLocalizedPlatformHubLinks(locale)

  return (
    <header className="relative z-50 border-b border-border/80 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/88">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-6 py-4">
        <Link href={homeHref} className="flex items-center gap-3" aria-label="Coworkany">
          <div className="min-w-0">
            <Image src="/brand/coworkany-logo.png" alt="Coworkany" width={1120} height={228} className="h-8 w-auto object-contain object-left" priority />
            <div className="mt-1 font-display text-base font-bold uppercase tracking-[0.03em] text-foreground">
              {copy.header.tagline}
            </div>
          </div>
        </Link>

        <nav className="hidden flex-1 items-center justify-center gap-1 lg:flex">
          {copy.header.navItems.map((item) =>
            item.key === "tools" ? (
              <div key={item.key} className="group relative z-10 shrink-0">
                <Link
                  href={item.href}
                  className={cn(
                    "public-system-chip public-kicker inline-flex items-center gap-1.5 rounded-[4px] px-3 py-2 transition",
                    activeKey === item.key
                      ? "border border-primary/40 bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                  <ChevronDown className="h-3.5 w-3.5" />
                </Link>

                <div className="invisible absolute left-1/2 top-full z-[70] mt-2 w-[min(92vw,680px)] -translate-x-1/2 translate-y-1 rounded-[10px] border border-border bg-card p-3 opacity-0 shadow-xl transition duration-150 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                    <div className="min-w-0 rounded-[8px] border border-border/70 bg-background/40 p-2">
                      <div className="px-2 pb-2 pt-1 font-display text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                        {toolMenuLabels.tools}
                      </div>
                      <div className="max-h-[min(70vh,560px)] space-y-1 overflow-y-auto pr-1">
                        {liveTools.map((tool) => (
                          <Link
                            key={tool.slug}
                            href={localizePublicPath(tool.href, locale)}
                            className="block rounded-[8px] px-3 py-2.5 transition hover:bg-background"
                          >
                            <div className="font-display text-xs font-bold uppercase tracking-[0.08em] text-foreground">{tool.name}</div>
                            <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{tool.tagline}</div>
                          </Link>
                        ))}
                      </div>
                      <div className="mt-2 border-t border-border pt-2">
                        <Link
                          href={item.href}
                          className="block rounded-[8px] px-3 py-2 text-xs font-medium text-muted-foreground transition hover:bg-background hover:text-foreground"
                        >
                          {toolMenuLabels.allTools}
                        </Link>
                      </div>
                    </div>

                    <div className="min-w-0 rounded-[8px] border border-border/70 bg-background/40 p-2">
                      <div className="px-2 pb-2 pt-1 font-display text-[11px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                        {toolMenuLabels.platform}
                      </div>
                      <div className="max-h-[min(70vh,560px)] space-y-1 overflow-y-auto pr-1">
                        {platformLinks.map((item) => (
                          <Link
                            key={item.slug}
                            href={localizePublicPath(item.href, locale)}
                            className="block rounded-[8px] px-3 py-2.5 transition hover:bg-background"
                          >
                            <div className="font-display text-xs font-bold uppercase tracking-[0.08em] text-foreground">{item.title}</div>
                            <div className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.summary}</div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <Link
                key={item.key}
                href={item.href}
                className={cn(
                  "public-system-chip public-kicker rounded-[4px] px-3 py-2 transition",
                  activeKey === item.key
                    ? "border border-primary/40 bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            ),
          )}
        </nav>

        <div className="flex items-center gap-3">
          <LocaleSwitcher className="hidden rounded-[4px] border-border bg-card sm:inline-flex" />
          <Button variant="ghost" className="public-system-chip hidden rounded-[4px] px-4 font-display text-xs font-bold uppercase tracking-[0.08em] sm:inline-flex" asChild>
            <Link href="/login">{copy.header.login}</Link>
          </Button>
          <Button className="public-button-primary h-10 px-5" asChild>
            <TrackedCtaLink
              href="/register"
              eventName={SEO_EVENT.seoPageCtaClick}
              eventData={{
                group: activeKey || "homepage",
                slug: "header",
                placement: "header",
                cta: "primary",
                destination: "/register",
              }}
            >
              {copy.header.startWorkspace}
            </TrackedCtaLink>
          </Button>
        </div>
      </div>
    </header>
  )
}
