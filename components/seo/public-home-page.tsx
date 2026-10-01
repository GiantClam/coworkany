"use client"

import { TrackedCtaLink } from "@/components/seo/tracked-cta-link"
import { useI18n } from "@/components/locale-provider"
import type { AppLocale } from "@/lib/i18n/config"
import { SEO_EVENT } from "@/lib/seo/analytics"
import { ArrowRight } from "lucide-react"
import { CoworkanyHomePage } from "./coworkany-home"

export function PublicHomePageContent({ locale }: { locale: AppLocale }) {
  const { setLocale } = useI18n()

  return <CoworkanyHomePage
    locale={locale}
    onLocaleChange={setLocale}
    renderStartLink={({ children, placement, compact, href, className }) => <TrackedCtaLink href={href} prefetch={false} className={className} eventName={SEO_EVENT.seoPageCtaClick} eventData={{ group: "homepage", slug: "coworkany", placement, cta: "primary", destination: href }}>{children}{!compact && <ArrowRight size={18} aria-hidden="true" />}</TrackedCtaLink>}
  />
}
