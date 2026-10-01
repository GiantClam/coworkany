"use client"

import Link from "next/link"
import Image from "next/image"
import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react"
import { ArrowDownRight, ArrowRight, FileText, Menu, Network, Plus, SlidersHorizontal, X } from "lucide-react"

import type { AppLocale } from "@/lib/i18n/config"
import { WORKBENCH_THEME } from "@/packages/workbench-ui/src/design-tokens"
import { COWORKANY_RELEASES_URL, COWORKANY_REPOSITORY_URL, getCoworkanyHomeCopy, getCoworkanyScenarios } from "./coworkany-home-copy"
import { CoworkanyMark, DesktopPreview, HeroProductPreview, ScenarioPreview } from "./coworkany-product-preview"
import styles from "./coworkany-home.module.css"

const homeThemeStyle = {
  "--paper": WORKBENCH_THEME.light.background,
  "--ink": WORKBENCH_THEME.light.foreground,
  "--accent": WORKBENCH_THEME.light.primary,
  "--accent-ink": WORKBENCH_THEME.light.primaryForeground,
  "--surface": WORKBENCH_THEME.light.card,
  "--surface-muted": WORKBENCH_THEME.light.muted,
  "--line": WORKBENCH_THEME.light.border,
} as CSSProperties

type StartLinkProps = { children: ReactNode; placement: string; compact?: boolean }
type StartLinkRenderer = (props: StartLinkProps & { href: string; className: string }) => ReactNode

export type CoworkanyHomePageProps = {
  locale: AppLocale
  startHref?: string
  onLocaleChange?: (locale: AppLocale) => void
  onStartClick?: (placement: string) => void
  renderStartLink?: StartLinkRenderer
}

export function CoworkanyHomePage({ locale, startHref = "/register", onLocaleChange, onStartClick, renderStartLink }: CoworkanyHomePageProps) {
  const copy = getCoworkanyHomeCopy(locale)
  const scenarios = getCoworkanyScenarios(locale)
  const [activeScenario, setActiveScenario] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  const scenario = scenarios[activeScenario]
  const navTargets = ["capabilities", "use-cases", "desktop", "faq"]
  const pillarIcons = [FileText, Network, SlidersHorizontal]
  const renderStart = ({ children, placement, compact = false }: StartLinkProps) => {
    const className = `${styles.primaryButton} ${compact ? styles.compactButton : ""}`
    const props = { children, placement, compact, href: startHref, className }
    if (renderStartLink) return renderStartLink(props)
    return <Link href={startHref} prefetch={false} className={className} onClick={() => onStartClick?.(placement)}>{children}{!compact && <ArrowRight size={18} aria-hidden="true" />}</Link>
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number
    if (event.key === "ArrowRight") next = (index + 1) % scenarios.length
    else if (event.key === "ArrowLeft") next = (index + scenarios.length - 1) % scenarios.length
    else if (event.key === "Home") next = 0
    else if (event.key === "End") next = scenarios.length - 1
    else return
    event.preventDefault()
    setActiveScenario(next)
    tabRefs.current[next]?.focus()
  }

  const nextLocale: AppLocale = locale === "zh" ? "en" : "zh"
  const faqSchema = {
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: copy.faqs.map(faq => ({ "@type": "Question", name: faq.question, acceptedAnswer: { "@type": "Answer", text: faq.answer } })),
  }

  return (
    <div className={styles.site} style={homeThemeStyle} lang={locale === "zh" ? "zh-CN" : "en"}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema).replace(/</g, "\\u003c") }} />
      <a href="#main" className={styles.skipLink}>{copy.skip}</a>
      <header className={styles.header} onKeyDown={event => { if (event.key === "Escape") { setMenuOpen(false); menuButton.current?.focus() } }}>
        <div className={styles.navbar}>
          <Link href={`/${locale}`} className={styles.brand} aria-label="Coworkany"><Image src="/brand/coworkany-logo.png" alt="" width={1120} height={228} className={styles.brandLogo} priority /></Link>
          <nav className={styles.desktopNav} aria-label={copy.menu}>{copy.nav.map((label, i) => <a key={label} href={`#${navTargets[i]}`}>{label}</a>)}</nav>
          <div className={styles.navActions}>
            <a href={`/${nextLocale}`} hrefLang={nextLocale === "zh" ? "zh-CN" : "en"} onClick={() => onLocaleChange?.(nextLocale)} className={styles.languageLink} aria-label={locale === "zh" ? "Switch to English" : "切换为中文"}>{locale === "zh" ? "EN" : "中文"}</a>
            {renderStart({ placement: "header", compact: true, children: copy.start })}
            <button ref={menuButton} type="button" className={styles.menuButton} aria-label={copy.menu} aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={21} /> : <Menu size={21} />}</button>
          </div>
        </div>
        <nav id="mobile-navigation" className={styles.mobileNav} hidden={!menuOpen} aria-label={copy.menu}>{copy.nav.map((label, i) => <a key={label} href={`#${navTargets[i]}`} onClick={() => setMenuOpen(false)}>{label}<ArrowRight size={15} aria-hidden="true" /></a>)}</nav>
      </header>

      <main id="main">
        <section className={styles.hero} aria-labelledby="hero-title">
          <h1 id="hero-title">{copy.hero[0]}<br /><span>{copy.hero[1]}<CoworkanyMark /></span></h1>
          <p className={styles.heroDescription}>{copy.description}</p>
          <div className={styles.heroActions}>{renderStart({ placement: "hero", children: copy.start })}<a className={styles.secondaryButton} href="#use-cases"><ArrowDownRight size={18} aria-hidden="true" />{copy.demo}</a></div>
          <p className={styles.platforms}>{copy.platforms}</p>
          <div className={styles.container}><HeroProductPreview copy={copy} scenarios={scenarios} startHref={startHref} onSelectScenario={setActiveScenario} /></div>
        </section>

        <section id="use-cases" className={`${styles.workSection} ${styles.container}`} aria-labelledby="work-title">
          <div className={styles.sectionIntro}><div><p className={styles.sectionLabel}>{copy.workLabel}</p><h2 id="work-title">{copy.workTitle[0]}<br />{copy.workTitle[1]}</h2></div><p className={styles.sectionDescription}>{copy.workDescription}</p></div>
          <div role="tablist" aria-label={copy.nav[1]} className={styles.tabs}>{scenarios.map((item, index) => <button key={item.id} ref={element => { tabRefs.current[index] = element }} id={`tab-${item.id}`} role="tab" type="button" aria-selected={activeScenario === index} aria-controls="scenario-panel" tabIndex={activeScenario === index ? 0 : -1} onKeyDown={event => handleTabKey(event, index)} onClick={() => setActiveScenario(index)}>{item.label}</button>)}</div>
          <div id="scenario-panel" role="tabpanel" aria-labelledby={`tab-${scenario.id}`} tabIndex={0} className={styles.scenarioPanel}><ScenarioPreview key={scenario.id} scenario={scenario} copy={copy} /><div className={styles.scenarioText}><p className={styles.sectionLabel}>0{activeScenario + 1} / {scenario.label}</p><h3>{scenario.title[0]}<br />{scenario.title[1]}</h3><p>{scenario.description}</p><a href={startHref} className={styles.textLink}>{copy.taskLink}<ArrowRight size={19} aria-hidden="true" /></a></div></div>
          <div id="capabilities" className={styles.pillars}>{copy.pillars.map((pillar, index) => { const Icon = pillarIcons[index]; return <article key={pillar.title}><Icon size={25} strokeWidth={1.4} aria-hidden="true" /><h3>{pillar.title}</h3><p>{pillar.description}</p></article> })}</div>
        </section>

        <section id="desktop" className={styles.desktopSection} aria-labelledby="desktop-title"><div className={`${styles.container} ${styles.desktopGrid}`}><div><p className={styles.sectionLabel}>{copy.desktopLabel}</p><h2 id="desktop-title">{copy.desktopTitle[0]}<br />{copy.desktopTitle[1]}</h2><p className={styles.desktopDescription}>{copy.desktopDescription}</p><a className={styles.primaryButton} href={COWORKANY_RELEASES_URL} target="_blank" rel="noopener noreferrer">{copy.download}<ArrowRight size={18} aria-hidden="true" /></a><p className={styles.downloadNote}>{copy.downloadNote}</p></div><DesktopPreview copy={copy} /></div></section>
        <section id="faq" className={`${styles.faqSection} ${styles.container}`} aria-labelledby="faq-title"><h2 id="faq-title">{copy.faqTitle}</h2><div className={styles.faqList}>{copy.faqs.map(faq => <details key={faq.question}><summary>{faq.question}<Plus size={20} aria-hidden="true" /></summary><p>{faq.answer}</p></details>)}</div></section>
        <section className={styles.closing}><CoworkanyMark /><h2>{copy.closing[0]}<br />{copy.closing[1]}</h2>{renderStart({ placement: "footer", children: copy.closingCta })}</section>
      </main>

      <footer className={`${styles.footer} ${styles.container}`}><div><Link href={`/${locale}`} className={styles.brand} aria-label="Coworkany"><Image src="/brand/coworkany-logo.png" alt="" width={1120} height={228} className={styles.brandLogo} /></Link><span>© {new Date().getFullYear()} Coworkany</span></div><div><nav aria-label={locale === "zh" ? "页脚导航" : "Footer navigation"}><a href="#capabilities">{copy.nav[0]}</a><a href="#desktop">{copy.nav[2]}</a><a href={COWORKANY_REPOSITORY_URL} target="_blank" rel="noopener noreferrer">GitHub<ArrowRight size={12} aria-hidden="true" /></a></nav><span>Your work. Your agent.</span></div></footer>
    </div>
  )
}
