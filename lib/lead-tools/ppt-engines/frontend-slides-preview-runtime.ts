import { randomUUID } from "node:crypto"

import { buildPptExportFileName } from "@/lib/lead-tools/ppt-export-file-name"
import type {
  PptPreviewDeck,
  PptPreviewStyleArchetype,
  PptPreviewStyleKey,
  PptPreviewVariant,
} from "@/lib/lead-tools/ppt-preview-data-fixed"
import type { LeadToolPptPreviewRuntime } from "@/lib/lead-tools/ppt-engines/preview-runtime-types"
import { storePptPreviewSessionDeck } from "@/lib/lead-tools/ppt-preview-session-store"
import {
  buildFrontendSlidesControllerScript,
  FRONTEND_SLIDES_VIEWPORT_BASE_CSS,
} from "@/lib/lead-tools/ppt-engines/frontend-slides-runtime-shell"
import { renderFrontendSlidesPosterAsset } from "@/lib/lead-tools/ppt-engines/frontend-slides-poster"
import {
  getFrontendSlidesRendererKeys,
  renderFrontendSlidesVariant,
} from "@/lib/lead-tools/ppt-engines/frontend-slides-renderer-registry"
import {
  deriveChartRowsFromTemplateFallbacks,
  deriveNeoGridChartRows,
  deriveNeoGridProcessRows,
  deriveProcessRowsFromTemplateFallbacks,
  getClosingRows,
  getComparisonRows,
  getContentsRows,
  getMetricRows,
  getSpotlightRows,
  getVariantSlideByIntent,
  getVariantSlideByLayout,
  partitionLongTableAgendaRows,
  repairVariantForRuntime,
} from "@/lib/lead-tools/ppt-engines/frontend-slides-structured-data"
import { buildFrontendSlidesVariantCss } from "@/lib/lead-tools/ppt-engines/frontend-slides-variant-css"
import { getFrontendSlidesTheme } from "@/lib/lead-tools/ppt-engines/frontend-slides-theme"
import {
  buildFrontendSlidesDeckDateStamp as buildDeckDateStamp,
  buildFrontendSlidesDeckIssueNumber as buildDeckIssueNumber,
  buildFrontendSlidesHeadlineDeckLabel as buildHeadlineDeckLabel,
  escapeFrontendSlidesHtml as escapeHtml,
  renderFrontendSlidesBulletList as renderBulletList,
  renderFrontendSlidesContentsCards as renderContentsCards,
  renderFrontendSlidesFooter as renderFooter,
  renderFrontendSlidesWorkflowImageFigure as renderWorkflowImageFigure,
} from "@/lib/lead-tools/ppt-engines/frontend-slides-view-helpers"

const NINE_PAGE_PROGRESS = [12, 24, 36, 48, 60, 72, 84, 92, 100] as const

function renderLongTableSlides(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const cover = getVariantSlideByIntent(variant, "cover", "cover")
  const agenda = getVariantSlideByIntent(variant, "contents", "agenda")
  const insight = getVariantSlideByIntent(variant, "statement", "insight")
  const comparison = getVariantSlideByIntent(variant, "comparison", "comparison")
  const evidence = getVariantSlideByIntent(variant, "spotlight", "evidence")
  const stats = getVariantSlideByIntent(variant, "stats", "stats")
  const chart = getVariantSlideByIntent(variant, "chart", "chart")
  const process = getVariantSlideByIntent(variant, "process", "process")
  const timeline = getVariantSlideByIntent(variant, "closing", "timeline")
  const variantOutline = variant.outline ?? deck.outline
  const coverPoints = (cover?.bullets ?? []).slice(0, 4)
  const agendaRows = getContentsRows(agenda, variantOutline)
  const { ledgerRows: longTableLedgerRows, signalRows: longTableSignalRows } = partitionLongTableAgendaRows(agendaRows)
  const insightPoints = (insight?.bullets ?? []).slice(0, 4)
  const comparisonRows = getComparisonRows(comparison)
  const spotlightRows = getSpotlightRows(evidence)
  const statsRows = getMetricRows(stats)
  const closingRows = getClosingRows(timeline)
  const chartRows = deriveChartRowsFromTemplateFallbacks({
    styleKey: "ppt169_brutalist_ai_newspaper_2026",
    slide: chart,
    comparisonRows,
    statsRows,
    spotlightRows,
  })
  const processRows = deriveProcessRowsFromTemplateFallbacks({
    styleKey: "ppt169_brutalist_ai_newspaper_2026",
    slide: process,
    closingRows,
    agendaRows,
    spotlightRows,
  })
  const issueNumber = buildDeckIssueNumber(variant)
  return [
    `
      <section class="slide long-table-cover">
        <div class="slide-content long-table-shell">
          <header class="long-table-header">
            <span class="eyebrow">${escapeHtml(cover?.kicker ?? "")}</span>
            <span class="table-caption">${escapeHtml(buildHeadlineDeckLabel(deck, variant))}</span>
          </header>
          <div class="ledger-grid long-table-cover-grid">
            <article class="ledger-hero">
              <div class="cover-ed-row">
                <span class="edition-badge">${issueNumber}</span>
                <span class="edition-label">briefing edition</span>
              </div>
              <h1 class="title">${escapeHtml(cover?.title ?? deck.title)}</h1>
              <div class="cover-actions">
                <span class="action-pill">${escapeHtml(deck.language)}</span>
                <span class="action-divider">|</span>
                <span class="action-pill">${escapeHtml(deck.scenario.replace(/-/g, " "))}</span>
              </div>
              <div class="cover-statline">
                <span class="stat-big">${escapeHtml(coverPoints[0] ?? cover?.kicker ?? "")}</span>
                <p class="subtitle">${escapeHtml(cover?.body ?? "")}</p>
              </div>
            </article>
            <div class="edition-column">
              <div class="big-edition">No. ${issueNumber}</div>
              <div class="big-edition-lab">${escapeHtml(buildDeckDateStamp(deck.generatedAt))} · ${escapeHtml(variant.name)}</div>
              <div class="big-edition-meta">${escapeHtml(variant.summary)}</div>
              ${renderWorkflowImageFigure(cover, "cover")}
              <aside class="panel committee-note">
                <h3>Table Stakes</h3>
                ${renderBulletList(cover?.bullets ?? [])}
                <div class="stake-meter-board">
                  ${coverPoints
                    .map(
                      (bullet, index) => `
                        <div class="stake-meter-row">
                          <span>${String(index + 1).padStart(2, "0")}</span>
                          <div class="stake-meter-track"><i style="width:${Math.max(38, Math.min(94, bullet.length * 4))}%"></i></div>
                        </div>`,
                    )
                    .join("")}
                </div>
              </aside>
            </div>
          </div>
          <div class="ledger-row">
            ${(cover?.bullets ?? []).slice(0, 4).map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[0])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content long-table-shell">
          <div class="eyebrow">${escapeHtml(agenda?.kicker ?? "")}</div>
          <div class="table-heading">
            <h2 class="title">${escapeHtml(agenda?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(agenda?.body ?? "")}</p>
          </div>
          <div class="agenda-ledger">
            ${renderContentsCards(longTableLedgerRows, "panel ledger-card")}
          </div>
          <div class="agenda-signal-line">
            ${longTableSignalRows
              .map(
                (item) => `
                  <div class="signal-node">
                    <span>${escapeHtml(item.index)}</span>
                    <p>${escapeHtml(item.title)}</p>
                  </div>`,
              )
              .join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[1])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content long-table-shell">
          <div class="long-table-quote">
            <span class="quote-kicker">${escapeHtml(insight?.kicker ?? "")}</span>
            <h2 class="title quote-body">${escapeHtml(insight?.title ?? "")}</h2>
            <p class="subtitle quote-desc">${escapeHtml(insight?.body ?? "")}</p>
            <div class="quote-signoff">
              ${insightPoints.map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}
            </div>
            ${renderWorkflowImageFigure(insight)}
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[2])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content long-table-shell">
          <div class="long-table-featured">
            <div class="featured-left">
              <div class="cover-ed-row">
                <span class="edition-badge">04</span>
                <span class="edition-label">${escapeHtml(comparison?.kicker ?? "")}</span>
              </div>
              <h2 class="title">${escapeHtml(comparison?.title ?? "")}</h2>
              <p class="subtitle">${escapeHtml(comparison?.body ?? "")}</p>
              <div class="stats-line">
                ${comparisonRows.slice(0, 2).map((item) => `<span class="rect-tag">${escapeHtml(item.title)}</span>`).join("")}
              </div>
            </div>
            <div class="featured-right panel">
              ${comparisonRows
                .map(
                  (item) => `
                    <div class="info-row">
                      <span class="info-key">${escapeHtml(item.label)}</span>
                      <div class="info-value"><strong>${escapeHtml(item.title)}</strong><br />${escapeHtml(item.detail)}</div>
                    </div>`,
                )
                .join("")}
            </div>
            ${renderWorkflowImageFigure(comparison)}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[3])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content long-table-shell">
          <div class="eyebrow">${escapeHtml(evidence?.kicker ?? "")}</div>
          <article class="panel desk-verdict">
            <span class="metric-kicker">${escapeHtml(evidence?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(evidence?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(evidence?.body ?? "")}</p>
          </article>
          <div class="decision-matrix">
            ${spotlightRows
              .map(
                (item, index) => `
                  <article class="panel matrix-row">
                    <span class="compare-label">${String(index + 1).padStart(2, "0")}</span>
                    <p><strong>${escapeHtml(item.title)}</strong><br />${escapeHtml(item.detail)}</p>
                  </article>`,
                )
                .join("")}
          </div>
          ${renderWorkflowImageFigure(evidence)}
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[4])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content long-table-shell">
          <div class="eyebrow">${escapeHtml(stats?.kicker ?? "")}</div>
          <h2 class="title">${escapeHtml(stats?.title ?? "")}</h2>
          <p class="subtitle">${escapeHtml(stats?.body ?? "")}</p>
          <div class="decision-matrix">
            ${statsRows
              .slice(0, 3)
              .map(
                (item) => `
                  <article class="panel matrix-row">
                    <span class="compare-label">${escapeHtml(item.value)}</span>
                    <p><strong>${escapeHtml(item.label)}</strong>${item.note ? `<br />${escapeHtml(item.note)}` : ""}</p>
                  </article>`,
              )
              .join("")}
          </div>
          <div class="panel matrix-trend">
            ${statsRows
              .slice(0, 3)
              .map(
                (item) => `
                  <div class="trend-row">
                    <span>${escapeHtml(item.value)}</span>
                    <div class="trend-track"><i style="width:${Math.max(42, Math.min(96, item.label.length * 4))}%"></i></div>
                  </div>`,
              )
              .join("")}
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[5])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content long-table-shell">
          <div class="long-table-index">
            <div class="topbar">
              <h2 class="title index-title">${escapeHtml(chart?.title ?? "")}</h2>
              <span class="table-caption">${escapeHtml(chart?.kicker ?? "")}</span>
            </div>
            <p class="subtitle">${escapeHtml(chart?.body ?? "")}</p>
            <div class="index-grid">
              ${chartRows
                .map(
                  (item, index) => `
                    <article class="panel index-card">
                      <div class="card-top">
                        <span class="num-tag">${String(index + 1).padStart(2, "0")}</span>
                        <span class="city-tag">${escapeHtml(item.label)}</span>
                      </div>
                      <h3>${escapeHtml(variantOutline[index + 4] ?? item.label)}</h3>
                      <p>${escapeHtml(item.detail)}</p>
                    </article>`,
                )
                .join("")}
            </div>
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[6])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content long-table-shell">
          <div class="long-table-schedule">
            <div class="topbar">
              <h2 class="title schedule-title">${escapeHtml(process?.title ?? "")}</h2>
              <span class="table-caption">${escapeHtml(process?.kicker ?? "")}</span>
            </div>
            <p class="subtitle">${escapeHtml(process?.body ?? "")}</p>
            <div class="schedule-ledger">
              <div class="schedule-row headrow">
                <div>Step</div>
                <div>Lane</div>
                <div>Action</div>
                <div>Signal</div>
              </div>
              ${processRows
                .map(
                  (item, index) => `
                    <div class="schedule-row">
                      <div class="num-tag">${escapeHtml(item.step)}</div>
                      <div class="city-tag">${escapeHtml(item.title)}</div>
                      <div class="theme">${escapeHtml(item.detail)}</div>
                      <div class="seats-pill">${escapeHtml(index === 0 ? "Now" : index === processRows.length - 1 ? "Ship" : "Next")}</div>
                    </div>`,
                )
                .join("")}
            </div>
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[7])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content long-table-shell">
          <div class="eyebrow">${escapeHtml(timeline?.kicker ?? "")}</div>
          <h2 class="title">${escapeHtml(timeline?.title ?? "")}</h2>
          <p class="subtitle">${escapeHtml(timeline?.body ?? "")}</p>
          <ol class="timeline-list schedule-band">
            ${closingRows
              .map(
                (item) => `
                  <li class="panel schedule-step">
                    <span class="timeline-step">${escapeHtml(item.label)}</span>
                    <p>${escapeHtml(item.detail)}</p>
                  </li>`,
              )
              .join("")}
          </ol>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[8])}
        </div>
      </section>
    `,
  ].join("\n")
}

function renderPlayfulSlides(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const cover = getVariantSlideByIntent(variant, "cover", "cover")
  const agenda = getVariantSlideByIntent(variant, "contents", "agenda")
  const insight = getVariantSlideByIntent(variant, "statement", "insight")
  const comparison = getVariantSlideByIntent(variant, "comparison", "comparison")
  const evidence = getVariantSlideByIntent(variant, "spotlight", "evidence")
  const stats = getVariantSlideByIntent(variant, "stats", "stats")
  const chart = getVariantSlideByIntent(variant, "chart", "chart")
  const process = getVariantSlideByIntent(variant, "process", "process")
  const timeline = getVariantSlideByIntent(variant, "closing", "timeline")
  const variantOutline = variant.outline ?? deck.outline
  const coverPoints = (cover?.bullets ?? []).slice(0, 4)
  const agendaRows = getContentsRows(agenda, variantOutline)
  const insightPoints = (insight?.bullets ?? []).slice(0, 4)
  const comparisonRows = getComparisonRows(comparison)
  const spotlightRows = getSpotlightRows(evidence)
  const statsRows = getMetricRows(stats)
  const closingRows = getClosingRows(timeline)
  const chartRows = deriveNeoGridChartRows({
    chart,
    comparisonRows,
    statsRows,
    spotlightRows,
  })
  const processRows = deriveNeoGridProcessRows({
    process,
    closingRows,
    agendaRows,
    spotlightRows,
  })
  const coverDate = buildDeckDateStamp(deck.generatedAt)
  return [
    `
      <section class="slide playful-cover">
        <div class="slide-content playful-shell">
          <div class="playful-orbit"></div>
          <div class="playful-orbit playful-orbit-secondary"></div>
          <div class="playful-date">${escapeHtml(coverDate)}</div>
          <div class="brand-ribbon">
            <span class="brand-chip">${escapeHtml(cover?.kicker ?? "")}</span>
            <span class="brand-chip">${escapeHtml(deck.language)}</span>
            <span class="brand-chip">${escapeHtml(deck.scenario.replace(/-/g, " "))}</span>
          </div>
          <article class="panel bubble-panel">
            <h1 class="title">${escapeHtml(cover?.title ?? deck.title)}</h1>
            <p class="subtitle">${escapeHtml(cover?.body ?? "")}</p>
            <div class="brand-signal-line">
              ${coverPoints
                .map(
                  (bullet, index) => `
                    <div class="spark-point spark-${index + 1}">
                      <span>${String(index + 1).padStart(2, "0")}</span>
                    </div>`,
                )
                .join("")}
              <svg viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true">
                <path d="M2 20 C16 4, 28 24, 42 12 S70 6, 98 18"></path>
              </svg>
            </div>
          </article>
          ${renderWorkflowImageFigure(cover, "cover")}
          <div class="play-card-grid">
            ${coverPoints
              .map(
                (bullet, index) => `
                  <article class="panel play-card">
                    <span class="card-index">${String(index + 1).padStart(2, "0")}</span>
                    <p>${escapeHtml(bullet)}</p>
                  </article>`,
              )
              .join("")}
          </div>
          <div class="playful-side-note">BRAND STORY ARC</div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[0])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content playful-shell">
          <div class="eyebrow">${escapeHtml(agenda?.kicker ?? "")}</div>
          <h2 class="title">${escapeHtml(agenda?.title ?? "")}</h2>
          <p class="subtitle">${escapeHtml(agenda?.body ?? "")}</p>
          <div class="play-note-grid">
            ${renderContentsCards(agendaRows, "panel play-note")}
          </div>
          <div class="brand-flow">
            ${agendaRows
              .map(
                (item) => `
                  <div class="flow-node">
                    <span>${escapeHtml(item.index)}</span>
                    <p>${escapeHtml(item.title)}</p>
                  </div>`,
              )
              .join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[1])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content playful-shell playful-vision-slide">
          <div class="eyebrow">${escapeHtml(insight?.kicker ?? "")}</div>
          <h2 class="title playful-vision-title">${escapeHtml(insight?.title ?? "")}</h2>
          <div class="playful-body-columns">
            <p class="body-text">${escapeHtml(insight?.body ?? "")}</p>
            <div class="playful-vision-tags">
              ${insightPoints.map((bullet) => `<span class="brand-chip">${escapeHtml(bullet)}</span>`).join("")}
            </div>
          </div>
          ${renderWorkflowImageFigure(insight)}
          <div class="brand-frame" aria-hidden="true"></div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[2])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content playful-shell playful-comparison-slide">
          <div class="eyebrow">${escapeHtml(comparison?.kicker ?? "")}</div>
          <h2 class="title">${escapeHtml(comparison?.title ?? "")}</h2>
          <p class="subtitle">${escapeHtml(comparison?.body ?? "")}</p>
          <div class="playful-services-collage">
            ${comparisonRows.map(
              (item, index) => `
                <article class="panel service-block ${index === 0 ? "filled" : ""}">
                  <span class="compare-label">${escapeHtml(item.label)}</span>
                  <h3>${escapeHtml(item.title)}</h3>
                  <p>${escapeHtml(item.detail)}</p>
                </article>`,
            ).join("")}
          </div>
          ${renderWorkflowImageFigure(comparison)}
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[3])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content playful-shell">
          <div class="eyebrow">${escapeHtml(evidence?.kicker ?? "")}</div>
          <div class="play-spark panel">
            <span class="metric-kicker">${escapeHtml(evidence?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(evidence?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(evidence?.body ?? "")}</p>
          </div>
          <div class="brand-ribbon insight-band">
            ${spotlightRows.map((item) => `<span class="brand-chip">${escapeHtml(item.title)}</span>`).join("")}
          </div>
          <div class="play-card-grid">
            ${spotlightRows
              .map(
                (item, index) => `
                  <article class="panel play-card">
                    <span class="card-index">${String(index + 1).padStart(2, "0")}</span>
                    <p><strong>${escapeHtml(item.title)}</strong><br />${escapeHtml(item.detail)}</p>
                  </article>`,
                )
              .join("")}
          </div>
          ${renderWorkflowImageFigure(evidence)}
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[4])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content playful-shell playful-stats-slide">
          <div class="eyebrow">${escapeHtml(stats?.kicker ?? "")}</div>
          <h2 class="title">${escapeHtml(stats?.title ?? "")}</h2>
          <p class="subtitle">${escapeHtml(stats?.body ?? "")}</p>
          <div class="playful-stats-grid">
            ${statsRows
              .slice(0, 3)
              .map(
                (item) => `
                  <article class="stat-item">
                    <div class="stat-num">${escapeHtml(item.value)}</div>
                    <p><strong>${escapeHtml(item.label)}</strong>${item.note ? `<br />${escapeHtml(item.note)}` : ""}</p>
                  </article>`,
              )
              .join("")}
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[5])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content playful-shell playful-chart-slide">
          <div class="eyebrow">${escapeHtml(chart?.kicker ?? "")}</div>
          <div class="playful-chart-header">
            <h2 class="title chart-title">${escapeHtml(chart?.title ?? "")}</h2>
            <div class="chart-legend">
              <span><i class="legend-dot"></i>${escapeHtml(chart?.kicker ?? "")}</span>
              <span><i class="legend-dot alt"></i>${escapeHtml(variant.name)}</span>
            </div>
          </div>
          <p class="subtitle">${escapeHtml(chart?.body ?? "")}</p>
          <div class="playful-chart-area">
            <div class="y-axis">
              <span>100</span>
              <span>75</span>
              <span>50</span>
              <span>25</span>
              <span>0</span>
            </div>
            <div class="chart-bars">
              ${chartRows
                .map(
                  (item, index) => `
                    <div class="bar-group">
                      <div class="bar ${index % 2 === 1 ? "alt" : ""}" style="height:${Math.max(26, Math.min(88, item.value))}%"></div>
                      <span class="bar-label">${escapeHtml(item.label)}</span>
                    </div>`,
                )
                .join("")}
            </div>
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[6])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content playful-shell playful-process-slide">
          <div class="eyebrow">${escapeHtml(process?.kicker ?? "")}</div>
          <h2 class="title timeline-title">${escapeHtml(process?.title ?? "")}</h2>
          <p class="subtitle">${escapeHtml(process?.body ?? "")}</p>
          <div class="timeline-track">
            ${processRows
              .map(
                (item, index) => `
                  <article class="timeline-step-card">
                    <div class="step-node ${index % 2 === 0 ? "filled" : ""}">${escapeHtml(item.step)}</div>
                    <h3 class="step-title">${escapeHtml(item.title)}</h3>
                    <p class="step-desc">${escapeHtml(item.detail)}</p>
                  </article>`,
              )
              .join("")}
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[7])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content playful-shell">
          <div class="eyebrow">${escapeHtml(timeline?.kicker ?? "")}</div>
          <h2 class="title">${escapeHtml(timeline?.title ?? "")}</h2>
          <p class="subtitle">${escapeHtml(timeline?.body ?? "")}</p>
          <ol class="timeline-list ribbon-timeline">
            ${closingRows
              .map(
                (item) => `
                  <li class="panel ribbon-step">
                    <span class="timeline-step">${escapeHtml(item.label)}</span>
                    <p>${escapeHtml(item.detail)}</p>
                  </li>`,
              )
              .join("")}
          </ol>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[8])}
        </div>
      </section>
    `,
  ].join("\n")
}

function renderBroadsideSlides(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const cover = getVariantSlideByLayout(variant, "cover")
  const agenda = getVariantSlideByLayout(variant, "agenda")
  const insight = getVariantSlideByLayout(variant, "insight")
  const comparison = getVariantSlideByLayout(variant, "comparison")
  const evidence = getVariantSlideByLayout(variant, "evidence")
  const stats = getVariantSlideByLayout(variant, "stats")
  const chart = getVariantSlideByLayout(variant, "chart")
  const process = getVariantSlideByLayout(variant, "process")
  const timeline = getVariantSlideByLayout(variant, "timeline")
  const variantOutline = variant.outline ?? deck.outline
  const coverPoints = (cover?.bullets ?? []).slice(0, 3)
  const agendaRows = getContentsRows(agenda, variantOutline)
  const comparisonRows = getComparisonRows(comparison)
  const spotlightRows = getSpotlightRows(evidence)
  const statsRows = getMetricRows(stats)
  const closingRows = getClosingRows(timeline)
  const chartRows = deriveChartRowsFromTemplateFallbacks({
    styleKey: "ppt169_pritzker_2026",
    slide: chart,
    comparisonRows,
    statsRows,
    spotlightRows,
  })
  const processRows = deriveProcessRowsFromTemplateFallbacks({
    styleKey: "ppt169_pritzker_2026",
    slide: process,
    closingRows,
    agendaRows,
    spotlightRows,
  })

  return [
    `
      <section class="slide broadside-cover-page">
        <div class="slide-content broadside-shell broadside-cover-shell">
          <div class="broadside-top-chrome">
            <span class="broadside-num">01</span>
            <span class="corner-label">${escapeHtml(variant.name)}</span>
          </div>
          <div class="cover-signal-strip">
            ${coverPoints.map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}
          </div>
          <div class="cover-body">
            <div class="eyebrow">${escapeHtml(cover?.kicker ?? "")}</div>
            <h1 class="title broadside-h1">${escapeHtml(cover?.title ?? deck.title)}</h1>
            <p class="subtitle broadside-lead">${escapeHtml(cover?.body ?? "")}</p>
          </div>
          <div class="cover-meta">
            <span>${escapeHtml(variant.summary)}</span>
            <span>${escapeHtml(deck.language)} / ${escapeHtml(deck.scenario.replace(/-/g, " "))}</span>
          </div>
          ${renderWorkflowImageFigure(cover, "cover")}
          <aside class="poster-columns">
            ${coverPoints.map((bullet) => `<article class="poster-slab"><p>${escapeHtml(bullet)}</p></article>`).join("")}
          </aside>
        </div>
      </section>
    `,
    `
      <section class="slide broadside-contents-page">
        <div class="slide-content broadside-shell">
          <div class="broadside-top-chrome">
            <span class="broadside-num">02 / Contents</span>
            <span class="corner-label">${escapeHtml(agenda?.kicker ?? "")}</span>
          </div>
          <h2 class="title">${escapeHtml(agenda?.title ?? "")}</h2>
          <p class="subtitle broadside-lead">${escapeHtml(agenda?.body ?? "")}</p>
          <div class="contents-board broadside-contents-board">
            ${agendaRows
              .slice(0, 8)
              .map(
                (item) => `
                  <article class="contents-card">
                    <span class="card-index">${escapeHtml(item.index)}</span>
                    <h3>${escapeHtml(item.title)}</h3>
                    <p>${escapeHtml(item.detail)}</p>
                  </article>`,
              )
              .join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[1])}
        </div>
      </section>
    `,
    `
      <section class="slide broadside-statement-page">
        <div class="slide-content broadside-shell">
          <div class="broadside-top-chrome">
            <span class="broadside-num">03</span>
            <span class="corner-label">${escapeHtml(insight?.kicker ?? "")}</span>
          </div>
          <div class="statement-shell">
            <span class="kicker-line">${escapeHtml(insight?.kicker ?? "")}</span>
            <div class="broadside-rule"></div>
            <h2 class="title broadside-h1 accent-ink">${escapeHtml(insight?.title ?? "")}</h2>
            <p class="subtitle broadside-lead">${escapeHtml(insight?.body ?? "")}</p>
          </div>
          ${renderWorkflowImageFigure(insight)}
          <div class="broadside-notes">
            ${(insight?.bullets ?? [])
              .slice(0, 4)
              .map((bullet) => `<div class="note-row"><span>/</span><p>${escapeHtml(bullet)}</p></div>`)
              .join("")}
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[2])}
        </div>
      </section>
    `,
    `
      <section class="slide broadside-statement-page">
        <div class="slide-content broadside-shell">
          <div class="broadside-top-chrome">
            <span class="broadside-num">04</span>
            <span class="corner-label">${escapeHtml(comparison?.kicker ?? "")}</span>
          </div>
          <div class="statement-shell">
            <span class="kicker-line">${escapeHtml(comparison?.kicker ?? "")}</span>
            <div class="broadside-rule"></div>
            <h2 class="title broadside-h1">${escapeHtml(comparison?.title ?? "")}</h2>
            <p class="subtitle broadside-lead">${escapeHtml(comparison?.body ?? "")}</p>
          </div>
          ${renderWorkflowImageFigure(comparison)}
          <div class="broadside-notes">
            ${comparisonRows.map((item) => `<div class="note-row"><span>${escapeHtml(item.label)}</span><p><strong>${escapeHtml(item.title)}</strong> ${escapeHtml(item.detail)}</p></div>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[3])}
        </div>
      </section>
    `,
    `
      <section class="slide broadside-statement-page">
        <div class="slide-content broadside-shell">
          <div class="broadside-top-chrome">
            <span class="broadside-num">05</span>
            <span class="corner-label">${escapeHtml(evidence?.kicker ?? "")}</span>
          </div>
          <div class="statement-shell">
            <span class="kicker-line">${escapeHtml(evidence?.kicker ?? "")}</span>
            <div class="broadside-rule"></div>
            <h2 class="title broadside-h1 accent-ink">${escapeHtml(evidence?.title ?? "")}</h2>
            <p class="subtitle broadside-lead">${escapeHtml(evidence?.body ?? "")}</p>
          </div>
          ${renderWorkflowImageFigure(evidence)}
          <div class="broadside-notes">
            ${spotlightRows
              .map((item, index) => `<div class="note-row"><span>${escapeHtml(String(index + 1).padStart(2, "0"))}</span><p><strong>${escapeHtml(item.title)}</strong> ${escapeHtml(item.detail)}</p></div>`)
              .join("")}
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[4])}
        </div>
      </section>
    `,
    `
      <section class="slide broadside-stats-page">
        <div class="slide-content broadside-shell">
          <div class="broadside-top-chrome">
            <span class="broadside-num">06</span>
            <span class="corner-label">${escapeHtml(stats?.kicker ?? "")}</span>
          </div>
          <div class="stats-grid-board">
            <article class="stat-highlight">
              <span class="stat-badge">${escapeHtml(stats?.kicker ?? "")}</span>
              <h2 class="title">${escapeHtml(stats?.title ?? "")}</h2>
              <p class="subtitle">${escapeHtml(stats?.body ?? "")}</p>
              <div class="stat-big">${String(statsRows.length || 1).padStart(2, "0")}</div>
            </article>
            <div class="market-barboard">
              ${statsRows
                .map((item, index) => ({
                  label: item.label || variantOutline[index] || `Track ${index + 1}`,
                  body: item.note ? `${item.label} · ${item.note}` : item.label,
                  width: Math.max(36, Math.min(92, Math.round((item.label.length + item.value.length) * 2.2))),
                }))
                .map(
                  (item) => `
                    <article class="bar-row">
                      <div class="bar-copy">
                        <span class="bar-label">${escapeHtml(item.label)}</span>
                        <p>${escapeHtml(item.body)}</p>
                      </div>
                      <div class="bar-track"><span class="bar-fill" style="width:${item.width}%"></span></div>
                    </article>`,
                )
                .join("")}
            </div>
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[5])}
        </div>
      </section>
    `,
    `
      <section class="slide broadside-stats-page">
        <div class="slide-content broadside-shell">
          <div class="broadside-top-chrome">
            <span class="broadside-num">07</span>
            <span class="corner-label">${escapeHtml(chart?.kicker ?? "")}</span>
          </div>
          <div class="stats-grid-board">
            <article class="stat-highlight">
              <span class="stat-badge">${escapeHtml(chart?.kicker ?? "")}</span>
              <h2 class="title">${escapeHtml(chart?.title ?? "")}</h2>
              <p class="subtitle">${escapeHtml(chart?.body ?? "")}</p>
              <div class="stat-big">${String(chartRows.length || 1).padStart(2, "0")}</div>
            </article>
            <div class="market-barboard">
              ${chartRows
                .map((item, index) => ({
                  label: item.label || `Path ${index + 1}`,
                  body: item.detail,
                  width: Math.max(36, Math.min(92, Math.round(item.value))),
                }))
                .map(
                  (item) => `
                    <article class="bar-row">
                      <div class="bar-copy">
                        <span class="bar-label">${escapeHtml(item.label)}</span>
                        <p>${escapeHtml(item.body)}</p>
                      </div>
                      <div class="bar-track"><span class="bar-fill" style="width:${item.width}%"></span></div>
                    </article>`,
                )
                .join("")}
            </div>
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[6])}
        </div>
      </section>
    `,
    `
      <section class="slide broadside-closing-page">
        <div class="slide-content broadside-shell">
          <div class="closing-banner">
            <span class="broadside-num">08 / Process</span>
            <span class="corner-label">${escapeHtml(process?.kicker ?? "")}</span>
          </div>
          <h2 class="title broadside-h1">${escapeHtml(process?.title ?? "")}</h2>
          <p class="subtitle broadside-lead">${escapeHtml(process?.body ?? "")}</p>
          <div class="closing-actions closing-blocks">
            ${processRows
              .map(
                (item) => `
                  <article class="closing-card">
                    <span class="closing-step">${escapeHtml(item.step)}</span>
                    <div class="closing-copy">
                      <strong>${escapeHtml(item.title)}</strong>
                      <p>${escapeHtml(item.detail)}</p>
                    </div>
                  </article>`,
              )
              .join("")}
          </div>
          <div class="cover-meta muted">
            <span>${escapeHtml(deck.title)}</span>
            <span>${escapeHtml(variant.name)}</span>
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[7])}
        </div>
      </section>
    `,
    `
      <section class="slide broadside-closing-page">
        <div class="slide-content broadside-shell">
          <div class="closing-banner">
            <span class="broadside-num">09 / Closing</span>
            <span class="corner-label">${escapeHtml(timeline?.kicker ?? "")}</span>
          </div>
          <h2 class="title broadside-h1">${escapeHtml(timeline?.title ?? "")}</h2>
          <p class="subtitle broadside-lead">${escapeHtml(timeline?.body ?? "")}</p>
          <div class="closing-actions closing-blocks">
            ${closingRows
              .map(
                (item) => `
                  <article class="closing-card">
                    <span class="closing-step">${escapeHtml(item.label)}</span>
                    <div class="closing-copy">
                      <strong>${escapeHtml(item.label)}</strong>
                      <p>${escapeHtml(item.detail)}</p>
                    </div>
                  </article>`,
              )
              .join("")}
          </div>
          <div class="cover-meta muted">
            <span>${escapeHtml(deck.title)}</span>
            <span>${escapeHtml(variant.name)}</span>
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[8])}
        </div>
      </section>
    `,
  ].join("\n")
}

function renderNeoGridBoldSlides(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const cover = getVariantSlideByIntent(variant, "cover", "cover")
  const agenda = getVariantSlideByIntent(variant, "contents", "agenda")
  const insight = getVariantSlideByIntent(variant, "statement", "insight")
  const comparison = getVariantSlideByIntent(variant, "comparison", "comparison")
  const evidence = getVariantSlideByIntent(variant, "spotlight", "evidence")
  const stats = getVariantSlideByIntent(variant, "stats", "stats")
  const chart = getVariantSlideByIntent(variant, "chart", "chart")
  const process = getVariantSlideByIntent(variant, "process", "process")
  const timeline = getVariantSlideByIntent(variant, "closing", "timeline")
  const variantOutline = variant.outline ?? deck.outline
  const coverPoints = (cover?.bullets ?? []).slice(0, 4)
  const agendaRows = getContentsRows(agenda, variantOutline)
  const insightPoints = (insight?.bullets ?? []).slice(0, 4)
  const comparisonRows = getComparisonRows(comparison)
  const spotlightRows = getSpotlightRows(evidence)
  const statsRows = getMetricRows(stats)
  const closingRows = getClosingRows(timeline)
  const chartRows = deriveNeoGridChartRows({
    chart,
    comparisonRows,
    statsRows,
    spotlightRows,
  })
  const processRows = deriveNeoGridProcessRows({
    process,
    closingRows,
    agendaRows,
    spotlightRows,
  })
  const issueNumber = buildDeckIssueNumber(variant)
  const agendaItems = agendaRows.map((item) => item.title)
  const agendaColumnCount = agendaItems.length >= 7 ? 3 : agendaItems.length >= 4 ? 2 : Math.max(1, agendaItems.length)
  const coverSignalCount = Math.max(4, coverPoints.length)
  const coverSignals = Array.from({ length: coverSignalCount }, (_, index) => coverPoints[index] ?? agendaItems[index] ?? "")
  const compactComparison = comparisonRows.length <= 3
  const compactProcess = processRows.length <= 3
  const compactSequence = closingRows.length <= 3
  const statCards = statsRows.map((item, index) => ({
    label: item.label || variantOutline[index + 1] || `Signal ${index + 1}`,
    body: item.note ? `${item.value} · ${item.note}` : item.value,
  }))
  const chartCards = chartRows.map((item, index) => ({
    label: item.label || `Path ${index + 1}`,
    body: item.detail,
    width: Math.max(34, Math.min(96, item.value)),
  }))

  return [
    `
      <section class="slide neo-grid-cover">
        <div class="slide-content neo-grid-shell">
          <div class="neo-grid-ruler">
            <span>${escapeHtml(deck.scenario.replace(/-/g, " "))}</span>
            <span>${escapeHtml(deck.language)}</span>
            <span>${escapeHtml(variant.name)}</span>
          </div>
          <div class="neo-grid-hero">
            <article class="asym-panel neo-cover-primary">
              <div class="neo-cover-chip">${escapeHtml(cover?.kicker ?? "")}</div>
              <div class="eyebrow">${escapeHtml(cover?.kicker ?? "")}</div>
              <h1 class="title">${escapeHtml(cover?.title ?? deck.title)}</h1>
              <p class="subtitle">${escapeHtml(cover?.body ?? "")}</p>
              <div class="neo-cover-tags">
                ${coverPoints.slice(0, 2).map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}
              </div>
            </article>
            <div class="neo-side-stack">
              ${renderWorkflowImageFigure(cover, "cover")}
              <div class="neo-cover-code panel">
                <div class="neo-qr-grid">
                  ${Array.from({ length: 16 }, (_, index) => `<i class="${index % 3 === 0 ? "accent" : ""}"></i>`).join("")}
                </div>
                <div class="neo-cover-code-copy">
                  <span>Issue ${issueNumber}</span>
                  <p>${escapeHtml(buildDeckDateStamp(deck.generatedAt))}</p>
                </div>
              </div>
              <aside class="module-strip panel">
                ${coverPoints
                  .map(
                    (bullet, index) => `
                      <div class="module-row">
                        <span>${String(index + 1).padStart(2, "0")}</span>
                        <p>${escapeHtml(bullet)}</p>
                      </div>`,
                  )
                  .join("")}
              </aside>
              <div class="signal-grid-board panel">
                ${coverSignals
                  .map(
                    (signal, index) => `
                      <div class="signal-cell ${index % 2 === 0 ? "accent" : ""}">
                        <span>${String(index + 1).padStart(2, "0")}</span>
                        ${signal ? `<p>${escapeHtml(signal)}</p>` : ""}
                      </div>`,
                  )
                  .join("")}
              </div>
            </div>
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[0])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content neo-grid-shell">
          <div class="eyebrow">${escapeHtml(agenda?.kicker ?? "")}</div>
          <h2 class="title">${escapeHtml(agenda?.title ?? "")}</h2>
          <p class="subtitle">${escapeHtml(agenda?.body ?? "")}</p>
          <div class="neo-module-rail" style="--rail-cols:${agendaColumnCount}">
            ${renderContentsCards(agendaRows, "panel neo-module")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[1])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content neo-grid-shell">
          <div class="neo-insight-grid">
            <article class="panel asym-panel">
              <span class="metric-kicker">${escapeHtml(insight?.kicker ?? "")}</span>
              <h2 class="title">${escapeHtml(insight?.title ?? "")}</h2>
              <p class="subtitle">${escapeHtml(insight?.body ?? "")}</p>
            </article>
            <aside class="panel side-module">
              ${renderBulletList(insightPoints)}
            </aside>
          </div>
          ${renderWorkflowImageFigure(insight)}
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[2])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content neo-grid-shell">
          <div class="eyebrow">${escapeHtml(comparison?.kicker ?? "")}</div>
          <h2 class="title">${escapeHtml(comparison?.title ?? "")}</h2>
          <p class="subtitle">${escapeHtml(comparison?.body ?? "")}</p>
          <div class="grid-comparison-shell ${compactComparison ? "compact-shell" : ""}">
            <div class="grid-comparison-board panel">
              ${comparisonRows
                .map(
                  (item) => `
                    <div class="module-row">
                      <span>${escapeHtml(item.label)}</span>
                      <p><strong>${escapeHtml(item.title)}</strong><br />${escapeHtml(item.detail)}</p>
                    </div>`,
                )
                .join("")}
            </div>
            <div class="panel signal-chart ${compactComparison ? "compact-chart" : ""}">
              ${comparisonRows
                .map(
                  (item) => `
                    <div class="signal-chart-row">
                      <span>${escapeHtml(item.label)}</span>
                      <div class="signal-chart-track"><i style="width:${Math.max(34, Math.min(96, item.detail.length * 4))}%"></i></div>
                    </div>`,
                )
                .join("")}
            </div>
          </div>
          ${renderWorkflowImageFigure(comparison)}
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[3])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content neo-grid-shell">
          <div class="neo-insight-grid">
            <article class="panel asym-panel">
              <span class="metric-kicker">${escapeHtml(evidence?.kicker ?? "")}</span>
              <h2 class="title">${escapeHtml(evidence?.title ?? "")}</h2>
              <p class="subtitle">${escapeHtml(evidence?.body ?? "")}</p>
            </article>
            <aside class="panel side-module">
              ${renderBulletList(spotlightRows.map((item) => `${item.title}: ${item.detail}`))}
            </aside>
          </div>
          ${renderWorkflowImageFigure(evidence)}
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[4])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content neo-grid-shell">
          <div class="eyebrow">${escapeHtml(stats?.kicker ?? "")}</div>
          <h2 class="title">${escapeHtml(stats?.title ?? "")}</h2>
          <p class="subtitle">${escapeHtml(stats?.body ?? "")}</p>
          <div class="neo-module-rail" style="--rail-cols:${Math.min(3, Math.max(2, statCards.length || 2))}">
            ${statCards
              .map(
                (item, index) => `
                  <article class="panel neo-module">
                    <span class="card-index">${String(index + 1).padStart(2, "0")}</span>
                    <h3>${escapeHtml(item.label)}</h3>
                    <p>${escapeHtml(item.body)}</p>
                  </article>`,
              )
              .join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[5])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content neo-grid-shell">
          <div class="eyebrow">${escapeHtml(chart?.kicker ?? "")}</div>
          <h2 class="title">${escapeHtml(chart?.title ?? "")}</h2>
          <p class="subtitle">${escapeHtml(chart?.body ?? "")}</p>
          <div class="grid-comparison-shell">
            <div class="panel signal-chart">
              ${chartCards
                .map(
                  (item) => `
                    <div class="signal-chart-row">
                      <span>${escapeHtml(item.label)}</span>
                      <div class="signal-chart-track"><i style="width:${item.width}%"></i></div>
                    </div>`,
                )
                .join("")}
            </div>
            <div class="signal-grid-board panel">
              ${chartCards
                .map(
                  (item, index) => `
                    <div class="signal-cell ${index % 2 === 0 ? "accent" : ""}">
                      <span>${String(index + 1).padStart(2, "0")}</span>
                      <p>${escapeHtml(item.body)}</p>
                    </div>`,
                )
                .join("")}
            </div>
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[6])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content neo-grid-shell">
          <div class="eyebrow">${escapeHtml(process?.kicker ?? "")}</div>
          <h2 class="title">${escapeHtml(process?.title ?? "")}</h2>
          <p class="subtitle">${escapeHtml(process?.body ?? "")}</p>
          <ol class="timeline-list sequence-rail ${compactProcess ? "horizontal-sequence" : ""}">
            ${processRows
              .map(
                (item) => `
                  <li class="sequence-row">
                    <span class="timeline-step">${escapeHtml(item.step)}</span>
                    <p><strong>${escapeHtml(item.title)}</strong><br />${escapeHtml(item.detail)}</p>
                  </li>`,
              )
              .join("")}
          </ol>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[7])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content neo-grid-shell">
          <div class="eyebrow">${escapeHtml(timeline?.kicker ?? "")}</div>
          <h2 class="title">${escapeHtml(timeline?.title ?? "")}</h2>
          <p class="subtitle">${escapeHtml(timeline?.body ?? "")}</p>
          <ol class="timeline-list sequence-rail ${compactSequence ? "horizontal-sequence" : ""}">
            ${closingRows
              .map(
                (item) => `
                  <li class="sequence-row">
                    <span class="timeline-step">${escapeHtml(item.label)}</span>
                    <p>${escapeHtml(item.detail)}</p>
                  </li>`,
              )
              .join("")}
          </ol>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[8])}
        </div>
      </section>
    `,
  ].join("\n")
}

function renderKubernetesBlueprintSlides(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const cover = getVariantSlideByLayout(variant, "cover")
  const agenda = getVariantSlideByLayout(variant, "agenda")
  const insight = getVariantSlideByLayout(variant, "insight")
  const comparison = getVariantSlideByLayout(variant, "comparison")
  const evidence = getVariantSlideByLayout(variant, "evidence")
  const stats = getVariantSlideByLayout(variant, "stats")
  const chart = getVariantSlideByLayout(variant, "chart")
  const process = getVariantSlideByLayout(variant, "process")
  const timeline = getVariantSlideByLayout(variant, "timeline")
  const variantOutline = variant.outline ?? deck.outline
  const coverPoints = (cover?.bullets ?? []).slice(0, 4)
  const agendaRows = getContentsRows(agenda, variantOutline)
  const insightRows = (insight?.bullets ?? []).slice(0, 4)
  const comparisonRows = getComparisonRows(comparison)
  const spotlightRows = getSpotlightRows(evidence)
  const statsRows = getMetricRows(stats)
  const closingRows = getClosingRows(timeline)
  const chartRows = deriveChartRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: chart,
    comparisonRows,
    statsRows,
    spotlightRows,
  })
  const processRows = deriveProcessRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: process,
    closingRows,
    agendaRows,
    spotlightRows,
  })

  return [
    `
      <section class="slide kube-cover">
        <div class="slide-content kube-shell">
          <div class="kube-topbar">
            <span class="kube-chip">${escapeHtml(cover?.kicker ?? variant.name)}</span>
            <span class="kube-meta">${escapeHtml(buildDeckDateStamp(deck.generatedAt))} / ${escapeHtml(deck.language)}</span>
          </div>
          <div class="kube-cover-grid">
            <article class="panel kube-cover-hero">
              <span class="eyebrow">${escapeHtml(buildHeadlineDeckLabel(deck, variant))}</span>
              <h1 class="title">${escapeHtml(cover?.title ?? deck.title)}</h1>
              <p class="subtitle">${escapeHtml(cover?.body ?? "")}</p>
              <div class="kube-chip-row">
                ${coverPoints.map((bullet) => `<span class="kube-chip">${escapeHtml(bullet)}</span>`).join("")}
              </div>
            </article>
            <aside class="panel kube-control-plane">
              <div class="kube-plane-label">Control Plane</div>
              <div class="kube-node-matrix">
                ${coverPoints
                  .map(
                    (bullet, index) => `
                      <article class="kube-node-card ${index === 0 ? "active" : ""}">
                        <span>${String(index + 1).padStart(2, "0")}</span>
                        <p>${escapeHtml(bullet)}</p>
                      </article>`,
                  )
                  .join("")}
              </div>
            </aside>
          </div>
          ${renderWorkflowImageFigure(cover, "cover")}
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[0])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content kube-shell">
          <div class="kube-section-head">
            <span class="eyebrow">${escapeHtml(agenda?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(agenda?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(agenda?.body ?? "")}</p>
          </div>
          <div class="kube-module-grid">
            ${agendaRows
              .slice(0, 6)
              .map(
                (item) => `
                  <article class="panel kube-module-card">
                    <span class="kube-module-index">${escapeHtml(item.index)}</span>
                    <h3>${escapeHtml(item.title)}</h3>
                    <p>${escapeHtml(item.detail)}</p>
                  </article>`,
              )
              .join("")}
          </div>
          <div class="kube-lane">
            ${agendaRows
              .slice(6)
              .map(
                (item) => `
                  <div class="kube-lane-item">
                    <span>${escapeHtml(item.index)}</span>
                    <p>${escapeHtml(item.title)}</p>
                  </div>`,
              )
              .join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[1])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content kube-shell">
          <div class="kube-section-head">
            <span class="eyebrow">${escapeHtml(insight?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(insight?.title ?? "")}</h2>
          </div>
          <div class="kube-blueprint-grid">
            <article class="panel kube-blueprint-primary">
              <p class="subtitle">${escapeHtml(insight?.body ?? "")}</p>
              <div class="kube-sequence-stack">
                ${insightRows
                  .map(
                    (bullet, index) => `
                      <div class="kube-sequence-row">
                        <span>${String(index + 1).padStart(2, "0")}</span>
                        <p>${escapeHtml(bullet)}</p>
                      </div>`,
                  )
                  .join("")}
              </div>
            </article>
            ${renderWorkflowImageFigure(insight)}
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[2])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content kube-shell">
          <div class="kube-section-head">
            <span class="eyebrow">${escapeHtml(comparison?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(comparison?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(comparison?.body ?? "")}</p>
          </div>
          <div class="kube-compare-board">
            ${comparisonRows
              .map(
                (item) => `
                  <article class="panel kube-compare-card">
                    <span class="kube-compare-label">${escapeHtml(item.label)}</span>
                    <h3>${escapeHtml(item.title)}</h3>
                    <p>${escapeHtml(item.detail)}</p>
                  </article>`,
              )
              .join("")}
          </div>
          ${renderWorkflowImageFigure(comparison)}
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[3])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content kube-shell">
          <div class="kube-section-head">
            <span class="eyebrow">${escapeHtml(evidence?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(evidence?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(evidence?.body ?? "")}</p>
          </div>
          <div class="kube-governance-lane">
            ${spotlightRows
              .map(
                (item, index) => `
                  <article class="panel kube-governance-card">
                    <span>${String(index + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>${escapeHtml(item.title)}</strong>
                      <p>${escapeHtml(item.detail)}</p>
                    </div>
                  </article>`,
              )
              .join("")}
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[4])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content kube-shell">
          <div class="kube-section-head">
            <span class="eyebrow">${escapeHtml(stats?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(stats?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(stats?.body ?? "")}</p>
          </div>
          <div class="kube-metric-grid">
            ${statsRows
              .map(
                (item) => `
                  <article class="panel kube-metric-card">
                    <span class="kube-metric-value">${escapeHtml(item.value)}</span>
                    <strong>${escapeHtml(item.label)}</strong>
                    ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
                  </article>`,
              )
              .join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[5])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content kube-shell">
          <div class="kube-section-head">
            <span class="eyebrow">${escapeHtml(chart?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(chart?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(chart?.body ?? "")}</p>
          </div>
          <div class="kube-chart-stack">
            ${chartRows
              .map(
                (item) => `
                  <article class="kube-chart-row">
                    <div class="kube-chart-copy">
                      <span>${escapeHtml(item.label)}</span>
                      <p>${escapeHtml(item.detail)}</p>
                    </div>
                    <div class="kube-chart-track"><i style="width:${Math.max(24, Math.min(96, item.value))}%"></i></div>
                  </article>`,
              )
              .join("")}
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[6])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content kube-shell">
          <div class="kube-section-head">
            <span class="eyebrow">${escapeHtml(process?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(process?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(process?.body ?? "")}</p>
          </div>
          <div class="kube-rollout-board">
            ${processRows
              .map(
                (item) => `
                  <article class="panel kube-rollout-card">
                    <span class="kube-rollout-step">${escapeHtml(item.step)}</span>
                    <h3>${escapeHtml(item.title)}</h3>
                    <p>${escapeHtml(item.detail)}</p>
                  </article>`,
              )
              .join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[7])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content kube-shell">
          <div class="kube-section-head">
            <span class="eyebrow">${escapeHtml(timeline?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(timeline?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(timeline?.body ?? "")}</p>
          </div>
          <div class="kube-sequence-stack kube-final-sequence">
            ${closingRows
              .map(
                (item) => `
                  <div class="kube-sequence-row">
                    <span>${escapeHtml(item.label)}</span>
                    <p>${escapeHtml(item.detail)}</p>
                  </div>`,
              )
              .join("")}
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[8])}
        </div>
      </section>
    `,
  ].join("\n")
}

function renderImageTextShowcaseSlides(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const cover = getVariantSlideByLayout(variant, "cover")
  const agenda = getVariantSlideByLayout(variant, "agenda")
  const insight = getVariantSlideByLayout(variant, "insight")
  const comparison = getVariantSlideByLayout(variant, "comparison")
  const evidence = getVariantSlideByLayout(variant, "evidence")
  const stats = getVariantSlideByLayout(variant, "stats")
  const chart = getVariantSlideByLayout(variant, "chart")
  const process = getVariantSlideByLayout(variant, "process")
  const timeline = getVariantSlideByLayout(variant, "timeline")
  const variantOutline = variant.outline ?? deck.outline
  const agendaRows = getContentsRows(agenda, variantOutline)
  const comparisonRows = getComparisonRows(comparison)
  const spotlightRows = getSpotlightRows(evidence)
  const statsRows = getMetricRows(stats)
  const chartRows = deriveChartRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: chart,
    comparisonRows,
    statsRows,
    spotlightRows,
  })
  const processRows = deriveProcessRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: process,
    closingRows: getClosingRows(timeline),
    agendaRows,
    spotlightRows,
  })
  const closingRows = getClosingRows(timeline)

  return [
    `
      <section class="slide showcase-cover">
        <div class="slide-content showcase-shell">
          <div class="showcase-header">
            <span class="eyebrow">${escapeHtml(cover?.kicker ?? variant.name)}</span>
            <span class="showcase-meta">${escapeHtml(buildDeckDateStamp(deck.generatedAt))} / ${escapeHtml(deck.scenario.replace(/-/g, " "))}</span>
          </div>
          <div class="showcase-hero-grid">
            <div class="showcase-copy">
              <h1 class="title">${escapeHtml(cover?.title ?? deck.title)}</h1>
              <p class="subtitle">${escapeHtml(cover?.body ?? "")}</p>
              <div class="showcase-caption-row">
                ${(cover?.bullets ?? []).slice(0, 4).map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}
              </div>
            </div>
            ${renderWorkflowImageFigure(cover, "cover")}
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[0])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content showcase-shell">
          <div class="showcase-header">
            <span class="eyebrow">${escapeHtml(agenda?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(agenda?.title ?? "")}</h2>
          </div>
          <p class="subtitle">${escapeHtml(agenda?.body ?? "")}</p>
          <div class="showcase-contact-sheet">
            ${agendaRows
              .map(
                (item) => `
                  <article class="panel showcase-sheet-card">
                    <span class="showcase-sheet-index">${escapeHtml(item.index)}</span>
                    <h3>${escapeHtml(item.title)}</h3>
                    <p>${escapeHtml(item.detail)}</p>
                  </article>`,
              )
              .join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[1])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content showcase-shell">
          <div class="showcase-spread">
            ${renderWorkflowImageFigure(insight, "cover")}
            <article class="panel showcase-editor-note">
              <span class="eyebrow">${escapeHtml(insight?.kicker ?? "")}</span>
              <h2 class="title">${escapeHtml(insight?.title ?? "")}</h2>
              <p class="subtitle">${escapeHtml(insight?.body ?? "")}</p>
              <div class="showcase-caption-row">
                ${(insight?.bullets ?? []).slice(0, 4).map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}
              </div>
            </article>
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[2])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content showcase-shell">
          <div class="showcase-header">
            <span class="eyebrow">${escapeHtml(comparison?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(comparison?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(comparison?.body ?? "")}</p>
          </div>
          <div class="showcase-spread reverse">
            <article class="panel showcase-comparison-stack">
              ${comparisonRows
                .map(
                  (item) => `
                    <div class="showcase-comparison-row">
                      <span>${escapeHtml(item.label)}</span>
                      <div>
                        <strong>${escapeHtml(item.title)}</strong>
                        <p>${escapeHtml(item.detail)}</p>
                      </div>
                    </div>`,
                )
                .join("")}
            </article>
            ${renderWorkflowImageFigure(comparison, "cover")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[3])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content showcase-shell">
          <div class="showcase-header">
            <span class="eyebrow">${escapeHtml(evidence?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(evidence?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(evidence?.body ?? "")}</p>
          </div>
          <div class="showcase-gallery-grid">
            ${spotlightRows
              .map(
                (item, index) => `
                  <article class="panel showcase-gallery-card">
                    <span>${String(index + 1).padStart(2, "0")}</span>
                    <strong>${escapeHtml(item.title)}</strong>
                    <p>${escapeHtml(item.detail)}</p>
                  </article>`,
              )
              .join("")}
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[4])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content showcase-shell">
          <div class="showcase-header">
            <span class="eyebrow">${escapeHtml(stats?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(stats?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(stats?.body ?? "")}</p>
          </div>
          <div class="showcase-metric-ribbon">
            ${statsRows
              .map(
                (item) => `
                  <article class="panel showcase-metric-tile">
                    <span class="showcase-metric-value">${escapeHtml(item.value)}</span>
                    <strong>${escapeHtml(item.label)}</strong>
                    ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
                  </article>`,
              )
              .join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[5])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content showcase-shell">
          <div class="showcase-header">
            <span class="eyebrow">${escapeHtml(chart?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(chart?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(chart?.body ?? "")}</p>
          </div>
          <div class="showcase-caption-board">
            ${chartRows
              .map(
                (item) => `
                  <article class="panel showcase-caption-card">
                    <strong>${escapeHtml(item.label)}</strong>
                    <p>${escapeHtml(item.detail)}</p>
                    <div class="showcase-caption-track"><i style="width:${Math.max(24, Math.min(96, item.value))}%"></i></div>
                  </article>`,
              )
              .join("")}
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[6])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content showcase-shell">
          <div class="showcase-header">
            <span class="eyebrow">${escapeHtml(process?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(process?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(process?.body ?? "")}</p>
          </div>
          <div class="showcase-sequence-board">
            ${processRows
              .map(
                (item) => `
                  <article class="panel showcase-sequence-card">
                    <span>${escapeHtml(item.step)}</span>
                    <h3>${escapeHtml(item.title)}</h3>
                    <p>${escapeHtml(item.detail)}</p>
                  </article>`,
              )
              .join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[7])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content showcase-shell">
          <div class="showcase-spread">
            <article class="panel showcase-editor-note">
              <span class="eyebrow">${escapeHtml(timeline?.kicker ?? "")}</span>
              <h2 class="title">${escapeHtml(timeline?.title ?? "")}</h2>
              <p class="subtitle">${escapeHtml(timeline?.body ?? "")}</p>
              <div class="showcase-closing-list">
                ${closingRows
                  .map(
                    (item) => `
                      <div class="showcase-comparison-row">
                        <span>${escapeHtml(item.label)}</span>
                        <div><p>${escapeHtml(item.detail)}</p></div>
                      </div>`,
                  )
                  .join("")}
              </div>
            </article>
            ${renderWorkflowImageFigure(timeline, "cover")}
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[8])}
        </div>
      </section>
    `,
  ].join("\n")
}

function renderFashionWeeklyDigestSlides(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const cover = getVariantSlideByLayout(variant, "cover")
  const agenda = getVariantSlideByLayout(variant, "agenda")
  const insight = getVariantSlideByLayout(variant, "insight")
  const comparison = getVariantSlideByLayout(variant, "comparison")
  const evidence = getVariantSlideByLayout(variant, "evidence")
  const stats = getVariantSlideByLayout(variant, "stats")
  const chart = getVariantSlideByLayout(variant, "chart")
  const process = getVariantSlideByLayout(variant, "process")
  const timeline = getVariantSlideByLayout(variant, "timeline")
  const variantOutline = variant.outline ?? deck.outline
  const agendaRows = getContentsRows(agenda, variantOutline)
  const comparisonRows = getComparisonRows(comparison)
  const spotlightRows = getSpotlightRows(evidence)
  const statsRows = getMetricRows(stats)
  const chartRows = deriveChartRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: chart,
    comparisonRows,
    statsRows,
    spotlightRows,
  })
  const processRows = deriveProcessRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: process,
    closingRows: getClosingRows(timeline),
    agendaRows,
    spotlightRows,
  })
  const closingRows = getClosingRows(timeline)

  return [
    `
      <section class="slide digest-cover">
        <div class="slide-content digest-shell">
          <div class="digest-masthead">
            <span class="digest-issue-kicker">${escapeHtml(cover?.kicker ?? "Issue")}</span>
            <span class="digest-issue-meta">${escapeHtml(buildDeckDateStamp(deck.generatedAt))} / ${escapeHtml(variant.name)}</span>
          </div>
          <div class="digest-cover-grid">
            <article class="digest-headline-block">
              <span class="eyebrow">${escapeHtml(deck.scenario.replace(/-/g, " "))}</span>
              <h1 class="title">${escapeHtml(cover?.title ?? deck.title)}</h1>
              <p class="subtitle">${escapeHtml(cover?.body ?? "")}</p>
            </article>
            ${renderWorkflowImageFigure(cover, "cover")}
          </div>
          <div class="digest-tag-ribbon">
            ${(cover?.bullets ?? []).slice(0, 4).map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[0])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content digest-shell">
          <div class="digest-spread-head">
            <span class="eyebrow">${escapeHtml(agenda?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(agenda?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(agenda?.body ?? "")}</p>
          </div>
          <div class="digest-spread-grid">
            ${agendaRows
              .map(
                (item) => `
                  <article class="panel digest-spread-card">
                    <span>${escapeHtml(item.index)}</span>
                    <h3>${escapeHtml(item.title)}</h3>
                    <p>${escapeHtml(item.detail)}</p>
                  </article>`,
              )
              .join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[1])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content digest-shell">
          <div class="digest-column-layout">
            <article class="digest-column-main">
              <span class="eyebrow">${escapeHtml(insight?.kicker ?? "")}</span>
              <h2 class="title">${escapeHtml(insight?.title ?? "")}</h2>
              <p class="subtitle">${escapeHtml(insight?.body ?? "")}</p>
              <div class="digest-column-notes">
                ${(insight?.bullets ?? [])
                  .slice(0, 4)
                  .map((bullet, index) => `<div><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(bullet)}</p></div>`)
                  .join("")}
              </div>
            </article>
            ${renderWorkflowImageFigure(insight, "cover")}
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[2])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content digest-shell">
          <div class="digest-spread-head">
            <span class="eyebrow">${escapeHtml(comparison?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(comparison?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(comparison?.body ?? "")}</p>
          </div>
          <div class="digest-compare-runway">
            ${comparisonRows
              .map(
                (item) => `
                  <article class="panel digest-compare-card">
                    <span>${escapeHtml(item.label)}</span>
                    <h3>${escapeHtml(item.title)}</h3>
                    <p>${escapeHtml(item.detail)}</p>
                  </article>`,
              )
              .join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[3])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content digest-shell">
          <div class="digest-spread-head">
            <span class="eyebrow">${escapeHtml(evidence?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(evidence?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(evidence?.body ?? "")}</p>
          </div>
          <div class="digest-editorial-strip">
            ${spotlightRows
              .map(
                (item, index) => `
                  <article class="panel digest-editorial-card">
                    <span>${String(index + 1).padStart(2, "0")}</span>
                    <strong>${escapeHtml(item.title)}</strong>
                    <p>${escapeHtml(item.detail)}</p>
                  </article>`,
              )
              .join("")}
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[4])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content digest-shell">
          <div class="digest-spread-head">
            <span class="eyebrow">${escapeHtml(stats?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(stats?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(stats?.body ?? "")}</p>
          </div>
          <div class="digest-metric-column">
            ${statsRows
              .map(
                (item) => `
                  <article class="digest-metric-row">
                    <span class="digest-metric-value">${escapeHtml(item.value)}</span>
                    <div>
                      <strong>${escapeHtml(item.label)}</strong>
                      ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
                    </div>
                  </article>`,
              )
              .join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[5])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content digest-shell">
          <div class="digest-spread-head">
            <span class="eyebrow">${escapeHtml(chart?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(chart?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(chart?.body ?? "")}</p>
          </div>
          <div class="digest-trend-board">
            ${chartRows
              .map(
                (item) => `
                  <article class="digest-trend-row">
                    <div class="digest-trend-copy">
                      <strong>${escapeHtml(item.label)}</strong>
                      <p>${escapeHtml(item.detail)}</p>
                    </div>
                    <div class="digest-trend-track"><i style="width:${Math.max(24, Math.min(96, item.value))}%"></i></div>
                  </article>`,
              )
              .join("")}
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[6])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content digest-shell">
          <div class="digest-spread-head">
            <span class="eyebrow">${escapeHtml(process?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(process?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(process?.body ?? "")}</p>
          </div>
          <div class="digest-run-of-show">
            ${processRows
              .map(
                (item) => `
                  <article class="panel digest-run-card">
                    <span>${escapeHtml(item.step)}</span>
                    <h3>${escapeHtml(item.title)}</h3>
                    <p>${escapeHtml(item.detail)}</p>
                  </article>`,
              )
              .join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[7])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content digest-shell">
          <div class="digest-column-layout">
            <article class="digest-column-main">
              <span class="eyebrow">${escapeHtml(timeline?.kicker ?? "")}</span>
              <h2 class="title">${escapeHtml(timeline?.title ?? "")}</h2>
              <p class="subtitle">${escapeHtml(timeline?.body ?? "")}</p>
              <div class="digest-column-notes">
                ${closingRows
                  .map(
                    (item) => `
                      <div>
                        <span>${escapeHtml(item.label)}</span>
                        <p>${escapeHtml(item.detail)}</p>
                      </div>`,
                  )
                  .join("")}
              </div>
            </article>
            ${renderWorkflowImageFigure(timeline, "cover")}
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[8])}
        </div>
      </section>
    `,
  ].join("\n")
}

function renderGlassmorphismDemoSlides(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const cover = getVariantSlideByLayout(variant, "cover")
  const agenda = getVariantSlideByLayout(variant, "agenda")
  const insight = getVariantSlideByLayout(variant, "insight")
  const comparison = getVariantSlideByLayout(variant, "comparison")
  const evidence = getVariantSlideByLayout(variant, "evidence")
  const stats = getVariantSlideByLayout(variant, "stats")
  const chart = getVariantSlideByLayout(variant, "chart")
  const process = getVariantSlideByLayout(variant, "process")
  const timeline = getVariantSlideByLayout(variant, "timeline")
  const variantOutline = variant.outline ?? deck.outline
  const agendaRows = getContentsRows(agenda, variantOutline)
  const comparisonRows = getComparisonRows(comparison)
  const spotlightRows = getSpotlightRows(evidence)
  const statsRows = getMetricRows(stats)
  const chartRows = deriveChartRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: chart,
    comparisonRows,
    statsRows,
    spotlightRows,
  })
  const processRows = deriveProcessRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: process,
    closingRows: getClosingRows(timeline),
    agendaRows,
    spotlightRows,
  })
  const closingRows = getClosingRows(timeline)

  return [
    `
      <section class="slide glass-cover">
        <div class="slide-content glass-shell">
          <div class="glass-orb glass-orb-a"></div>
          <div class="glass-orb glass-orb-b"></div>
          <div class="glass-topbar">
            <span class="glass-pill">${escapeHtml(cover?.kicker ?? variant.name)}</span>
            <span class="glass-meta">${escapeHtml(buildDeckDateStamp(deck.generatedAt))}</span>
          </div>
          <div class="glass-hero-grid">
            <article class="panel glass-hero-card">
              <h1 class="title">${escapeHtml(cover?.title ?? deck.title)}</h1>
              <p class="subtitle">${escapeHtml(cover?.body ?? "")}</p>
              <div class="glass-chip-cloud">
                ${(cover?.bullets ?? []).slice(0, 4).map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}
              </div>
            </article>
            <aside class="panel glass-score-card">
              <strong>HUD</strong>
              <div class="glass-score-rows">
                ${(cover?.bullets ?? []).slice(0, 4).map((bullet, index) => `
                  <div class="glass-score-row">
                    <span>${String(index + 1).padStart(2, "0")}</span>
                    <p>${escapeHtml(bullet)}</p>
                  </div>`).join("")}
              </div>
            </aside>
          </div>
          ${renderWorkflowImageFigure(cover, "cover")}
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[0])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content glass-shell">
          <div class="glass-section-head">
            <span class="eyebrow">${escapeHtml(agenda?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(agenda?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(agenda?.body ?? "")}</p>
          </div>
          <div class="glass-panel-grid">
            ${agendaRows.map((item) => `
              <article class="panel glass-panel-card">
                <span>${escapeHtml(item.index)}</span>
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.detail)}</p>
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[1])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content glass-shell">
          <div class="glass-split-view">
            <article class="panel glass-copy-panel">
              <span class="eyebrow">${escapeHtml(insight?.kicker ?? "")}</span>
              <h2 class="title">${escapeHtml(insight?.title ?? "")}</h2>
              <p class="subtitle">${escapeHtml(insight?.body ?? "")}</p>
              <div class="glass-caption-stack">
                ${(insight?.bullets ?? []).slice(0, 4).map((bullet, index) => `<div><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(bullet)}</p></div>`).join("")}
              </div>
            </article>
            ${renderWorkflowImageFigure(insight, "cover")}
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[2])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content glass-shell">
          <div class="glass-section-head">
            <span class="eyebrow">${escapeHtml(comparison?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(comparison?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(comparison?.body ?? "")}</p>
          </div>
          <div class="glass-compare-grid">
            ${comparisonRows.map((item) => `
              <article class="panel glass-compare-card">
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(item.title)}</strong>
                <p>${escapeHtml(item.detail)}</p>
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[3])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content glass-shell">
          <div class="glass-section-head">
            <span class="eyebrow">${escapeHtml(evidence?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(evidence?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(evidence?.body ?? "")}</p>
          </div>
          <div class="glass-spotlight-strip">
            ${spotlightRows.map((item, index) => `
              <article class="panel glass-spotlight-card">
                <span>${String(index + 1).padStart(2, "0")}</span>
                <strong>${escapeHtml(item.title)}</strong>
                <p>${escapeHtml(item.detail)}</p>
              </article>`).join("")}
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[4])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content glass-shell">
          <div class="glass-metric-board">
            ${statsRows.map((item) => `
              <article class="panel glass-metric-card">
                <span class="glass-metric-value">${escapeHtml(item.value)}</span>
                <strong>${escapeHtml(item.label)}</strong>
                ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[5])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content glass-shell">
          <div class="glass-section-head">
            <span class="eyebrow">${escapeHtml(chart?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(chart?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(chart?.body ?? "")}</p>
          </div>
          <div class="glass-chart-board">
            ${chartRows.map((item) => `
              <article class="panel glass-chart-row">
                <div class="glass-chart-copy">
                  <strong>${escapeHtml(item.label)}</strong>
                  <p>${escapeHtml(item.detail)}</p>
                </div>
                <div class="glass-chart-track"><i style="width:${Math.max(24, Math.min(96, item.value))}%"></i></div>
              </article>`).join("")}
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[6])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content glass-shell">
          <div class="glass-process-lane">
            ${processRows.map((item) => `
              <article class="panel glass-process-card">
                <span>${escapeHtml(item.step)}</span>
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.detail)}</p>
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[7])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content glass-shell">
          <article class="panel glass-closing-panel">
            <span class="eyebrow">${escapeHtml(timeline?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(timeline?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(timeline?.body ?? "")}</p>
            <div class="glass-caption-stack">
              ${closingRows.map((item) => `<div><span>${escapeHtml(item.label)}</span><p>${escapeHtml(item.detail)}</p></div>`).join("")}
            </div>
          </article>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[8])}
        </div>
      </section>
    `,
  ].join("\n")
}

function renderAttentionResearchSlides(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const cover = getVariantSlideByLayout(variant, "cover")
  const agenda = getVariantSlideByLayout(variant, "agenda")
  const insight = getVariantSlideByLayout(variant, "insight")
  const comparison = getVariantSlideByLayout(variant, "comparison")
  const evidence = getVariantSlideByLayout(variant, "evidence")
  const stats = getVariantSlideByLayout(variant, "stats")
  const chart = getVariantSlideByLayout(variant, "chart")
  const process = getVariantSlideByLayout(variant, "process")
  const timeline = getVariantSlideByLayout(variant, "timeline")
  const variantOutline = variant.outline ?? deck.outline
  const agendaRows = getContentsRows(agenda, variantOutline)
  const comparisonRows = getComparisonRows(comparison)
  const spotlightRows = getSpotlightRows(evidence)
  const statsRows = getMetricRows(stats)
  const chartRows = deriveChartRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: chart,
    comparisonRows,
    statsRows,
    spotlightRows,
  })
  const processRows = deriveProcessRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: process,
    closingRows: getClosingRows(timeline),
    agendaRows,
    spotlightRows,
  })
  const closingRows = getClosingRows(timeline)

  return [
    `
      <section class="slide paper-cover">
        <div class="slide-content paper-shell">
          <div class="paper-header">
            <span class="paper-kicker">${escapeHtml(cover?.kicker ?? variant.name)}</span>
            <span class="paper-meta">${escapeHtml(buildDeckDateStamp(deck.generatedAt))}</span>
          </div>
          <article class="paper-abstract">
            <h1 class="title">${escapeHtml(cover?.title ?? deck.title)}</h1>
            <p class="subtitle">${escapeHtml(cover?.body ?? "")}</p>
            <div class="paper-keywords">
              ${(cover?.bullets ?? []).slice(0, 4).map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}
            </div>
          </article>
          ${renderWorkflowImageFigure(cover, "cover")}
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[0])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content paper-shell">
          <div class="paper-section">
            <span class="paper-section-id">01</span>
            <div>
              <h2 class="title">${escapeHtml(agenda?.title ?? "")}</h2>
              <p class="subtitle">${escapeHtml(agenda?.body ?? "")}</p>
            </div>
          </div>
          <div class="paper-outline-board">
            ${agendaRows.map((item) => `
              <article class="paper-outline-row">
                <span>${escapeHtml(item.index)}</span>
                <div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div>
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[1])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content paper-shell">
          <div class="paper-section">
            <span class="paper-section-id">02</span>
            <div>
              <h2 class="title">${escapeHtml(insight?.title ?? "")}</h2>
              <p class="subtitle">${escapeHtml(insight?.body ?? "")}</p>
            </div>
          </div>
          <div class="paper-two-column">
            <div class="paper-proof-column">
              ${(insight?.bullets ?? []).slice(0, 4).map((bullet, index) => `<div class="paper-proof-row"><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(bullet)}</p></div>`).join("")}
            </div>
            ${renderWorkflowImageFigure(insight, "cover")}
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[2])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content paper-shell">
          <div class="paper-section">
            <span class="paper-section-id">03</span>
            <div>
              <h2 class="title">${escapeHtml(comparison?.title ?? "")}</h2>
              <p class="subtitle">${escapeHtml(comparison?.body ?? "")}</p>
            </div>
          </div>
          <div class="paper-table-grid">
            ${comparisonRows.map((item) => `
              <article class="paper-table-cell">
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(item.title)}</strong>
                <p>${escapeHtml(item.detail)}</p>
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[3])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content paper-shell">
          <div class="paper-section">
            <span class="paper-section-id">04</span>
            <div>
              <h2 class="title">${escapeHtml(evidence?.title ?? "")}</h2>
              <p class="subtitle">${escapeHtml(evidence?.body ?? "")}</p>
            </div>
          </div>
          <div class="paper-proof-column">
            ${spotlightRows.map((item, index) => `<div class="paper-proof-row"><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div></div>`).join("")}
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[4])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content paper-shell">
          <div class="paper-metric-table">
            ${statsRows.map((item) => `
              <article class="paper-metric-row">
                <span>${escapeHtml(item.value)}</span>
                <div><strong>${escapeHtml(item.label)}</strong>${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}</div>
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[5])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content paper-shell">
          <div class="paper-section">
            <span class="paper-section-id">05</span>
            <div>
              <h2 class="title">${escapeHtml(chart?.title ?? "")}</h2>
              <p class="subtitle">${escapeHtml(chart?.body ?? "")}</p>
            </div>
          </div>
          <div class="paper-chart-column">
            ${chartRows.map((item) => `
              <article class="paper-chart-row">
                <div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.detail)}</p></div>
                <div class="paper-chart-track"><i style="width:${Math.max(24, Math.min(96, item.value))}%"></i></div>
              </article>`).join("")}
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[6])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content paper-shell">
          <div class="paper-process-grid">
            ${processRows.map((item) => `
              <article class="paper-process-card">
                <span>${escapeHtml(item.step)}</span>
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.detail)}</p>
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[7])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content paper-shell">
          <article class="paper-conclusion">
            <h2 class="title">${escapeHtml(timeline?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(timeline?.body ?? "")}</p>
            <div class="paper-proof-column">
              ${closingRows.map((item) => `<div class="paper-proof-row"><span>${escapeHtml(item.label)}</span><p>${escapeHtml(item.detail)}</p></div>`).join("")}
            </div>
          </article>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[8])}
        </div>
      </section>
    `,
  ].join("\n")
}

function renderIndieBookstoreZineSlides(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const cover = getVariantSlideByLayout(variant, "cover")
  const agenda = getVariantSlideByLayout(variant, "agenda")
  const insight = getVariantSlideByLayout(variant, "insight")
  const comparison = getVariantSlideByLayout(variant, "comparison")
  const evidence = getVariantSlideByLayout(variant, "evidence")
  const stats = getVariantSlideByLayout(variant, "stats")
  const chart = getVariantSlideByLayout(variant, "chart")
  const process = getVariantSlideByLayout(variant, "process")
  const timeline = getVariantSlideByLayout(variant, "timeline")
  const variantOutline = variant.outline ?? deck.outline
  const agendaRows = getContentsRows(agenda, variantOutline)
  const comparisonRows = getComparisonRows(comparison)
  const spotlightRows = getSpotlightRows(evidence)
  const statsRows = getMetricRows(stats)
  const chartRows = deriveChartRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: chart,
    comparisonRows,
    statsRows,
    spotlightRows,
  })
  const processRows = deriveProcessRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: process,
    closingRows: getClosingRows(timeline),
    agendaRows,
    spotlightRows,
  })
  const closingRows = getClosingRows(timeline)

  return [
    `
      <section class="slide zine-cover">
        <div class="slide-content zine-shell">
          <div class="zine-masthead">
            <span class="zine-tag">${escapeHtml(cover?.kicker ?? variant.name)}</span>
            <span class="zine-date">${escapeHtml(buildDeckDateStamp(deck.generatedAt))}</span>
          </div>
          <div class="zine-cover-board">
            <article class="zine-title-block">
              <h1 class="title">${escapeHtml(cover?.title ?? deck.title)}</h1>
              <p class="subtitle">${escapeHtml(cover?.body ?? "")}</p>
            </article>
            ${renderWorkflowImageFigure(cover, "cover")}
          </div>
          <div class="zine-sticker-row">
            ${(cover?.bullets ?? []).slice(0, 4).map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[0])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content zine-shell">
          <div class="zine-spread-head">
            <span class="eyebrow">${escapeHtml(agenda?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(agenda?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(agenda?.body ?? "")}</p>
          </div>
          <div class="zine-index-board">
            ${agendaRows.map((item) => `
              <article class="zine-index-card">
                <span>${escapeHtml(item.index)}</span>
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.detail)}</p>
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[1])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content zine-shell">
          <div class="zine-split-spread">
            ${renderWorkflowImageFigure(insight, "cover")}
            <article class="zine-note-block">
              <span class="eyebrow">${escapeHtml(insight?.kicker ?? "")}</span>
              <h2 class="title">${escapeHtml(insight?.title ?? "")}</h2>
              <p class="subtitle">${escapeHtml(insight?.body ?? "")}</p>
              <div class="zine-margin-notes">
                ${(insight?.bullets ?? []).slice(0, 4).map((bullet, index) => `<div><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(bullet)}</p></div>`).join("")}
              </div>
            </article>
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[2])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content zine-shell">
          <div class="zine-compare-board">
            ${comparisonRows.map((item) => `
              <article class="zine-compare-card">
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(item.title)}</strong>
                <p>${escapeHtml(item.detail)}</p>
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[3])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content zine-shell">
          <div class="zine-quote-wall">
            ${spotlightRows.map((item, index) => `
              <article class="zine-quote-card">
                <span>${String(index + 1).padStart(2, "0")}</span>
                <strong>${escapeHtml(item.title)}</strong>
                <p>${escapeHtml(item.detail)}</p>
              </article>`).join("")}
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[4])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content zine-shell">
          <div class="zine-number-row">
            ${statsRows.map((item) => `
              <article class="zine-number-card">
                <span class="zine-number-value">${escapeHtml(item.value)}</span>
                <strong>${escapeHtml(item.label)}</strong>
                ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[5])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content zine-shell">
          <div class="zine-spread-head">
            <span class="eyebrow">${escapeHtml(chart?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(chart?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(chart?.body ?? "")}</p>
          </div>
          <div class="zine-ledger-list">
            ${chartRows.map((item) => `
              <article class="zine-ledger-row">
                <div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.detail)}</p></div>
                <div class="zine-ledger-track"><i style="width:${Math.max(24, Math.min(96, item.value))}%"></i></div>
              </article>`).join("")}
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[6])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content zine-shell">
          <div class="zine-runway-board">
            ${processRows.map((item) => `
              <article class="zine-runway-card">
                <span>${escapeHtml(item.step)}</span>
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.detail)}</p>
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[7])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content zine-shell">
          <article class="zine-closing-block">
            <span class="eyebrow">${escapeHtml(timeline?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(timeline?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(timeline?.body ?? "")}</p>
            <div class="zine-margin-notes">
              ${closingRows.map((item) => `<div><span>${escapeHtml(item.label)}</span><p>${escapeHtml(item.detail)}</p></div>`).join("")}
            </div>
          </article>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[8])}
        </div>
      </section>
    `,
  ].join("\n")
}

function renderGlobalAiCapitalSlides(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const cover = getVariantSlideByLayout(variant, "cover")
  const agenda = getVariantSlideByLayout(variant, "agenda")
  const insight = getVariantSlideByLayout(variant, "insight")
  const comparison = getVariantSlideByLayout(variant, "comparison")
  const evidence = getVariantSlideByLayout(variant, "evidence")
  const stats = getVariantSlideByLayout(variant, "stats")
  const chart = getVariantSlideByLayout(variant, "chart")
  const process = getVariantSlideByLayout(variant, "process")
  const timeline = getVariantSlideByLayout(variant, "timeline")
  const variantOutline = variant.outline ?? deck.outline
  const coverPoints = (cover?.bullets ?? []).slice(0, 4)
  const agendaRows = getContentsRows(agenda, variantOutline)
  const comparisonRows = getComparisonRows(comparison)
  const spotlightRows = getSpotlightRows(evidence)
  const statsRows = getMetricRows(stats)
  const chartRows = deriveChartRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: chart,
    comparisonRows,
    statsRows,
    spotlightRows,
  })
  const processRows = deriveProcessRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: process,
    closingRows: getClosingRows(timeline),
    agendaRows,
    spotlightRows,
  })
  const closingRows = getClosingRows(timeline)

  return [
    `
      <section class="slide capital-cover">
        <div class="slide-content capital-shell">
          <div class="capital-masthead">
            <span class="capital-chip">${escapeHtml(cover?.kicker ?? variant.name)}</span>
            <span class="capital-datestamp">${escapeHtml(buildDeckDateStamp(deck.generatedAt))}</span>
          </div>
          <div class="capital-hero-grid">
            <article class="capital-hero-copy">
              <span class="eyebrow">${escapeHtml(buildHeadlineDeckLabel(deck, variant))}</span>
              <h1 class="title">${escapeHtml(cover?.title ?? deck.title)}</h1>
              <p class="subtitle">${escapeHtml(cover?.body ?? "")}</p>
            </article>
            <aside class="panel capital-signal-board">
              ${coverPoints.map((bullet, index) => `
                <div class="capital-signal-row">
                  <span>${String(index + 1).padStart(2, "0")}</span>
                  <p>${escapeHtml(bullet)}</p>
                </div>`).join("")}
            </aside>
          </div>
          ${renderWorkflowImageFigure(cover, "cover")}
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[0])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content capital-shell">
          <div class="capital-section-head">
            <span class="eyebrow">${escapeHtml(agenda?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(agenda?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(agenda?.body ?? "")}</p>
          </div>
          <div class="capital-brief-grid">
            ${agendaRows.map((item) => `
              <article class="panel capital-brief-card">
                <span>${escapeHtml(item.index)}</span>
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.detail)}</p>
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[1])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content capital-shell">
          <div class="capital-quote-panel">
            <span class="eyebrow">${escapeHtml(insight?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(insight?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(insight?.body ?? "")}</p>
            <div class="capital-keyline">
              ${(insight?.bullets ?? []).slice(0, 4).map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}
            </div>
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[2])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content capital-shell">
          <div class="capital-section-head">
            <span class="eyebrow">${escapeHtml(comparison?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(comparison?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(comparison?.body ?? "")}</p>
          </div>
          <div class="capital-compare-board">
            ${comparisonRows.map((item) => `
              <article class="panel capital-compare-card">
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(item.title)}</strong>
                <p>${escapeHtml(item.detail)}</p>
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[3])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content capital-shell">
          <div class="capital-section-head">
            <span class="eyebrow">${escapeHtml(evidence?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(evidence?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(evidence?.body ?? "")}</p>
          </div>
          <div class="capital-evidence-list">
            ${spotlightRows.map((item, index) => `
              <article class="capital-evidence-row">
                <span>${String(index + 1).padStart(2, "0")}</span>
                <div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div>
              </article>`).join("")}
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[4])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content capital-shell">
          <div class="capital-metric-strip">
            ${statsRows.map((item) => `
              <article class="panel capital-metric-card">
                <span class="capital-metric-value">${escapeHtml(item.value)}</span>
                <strong>${escapeHtml(item.label)}</strong>
                ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[5])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content capital-shell">
          <div class="capital-section-head">
            <span class="eyebrow">${escapeHtml(chart?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(chart?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(chart?.body ?? "")}</p>
          </div>
          <div class="capital-market-bars">
            ${chartRows.map((item) => `
              <article class="capital-market-row">
                <div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.detail)}</p></div>
                <div class="capital-market-track"><i style="width:${Math.max(24, Math.min(96, item.value))}%"></i></div>
              </article>`).join("")}
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[6])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content capital-shell">
          <div class="capital-runway-grid">
            ${processRows.map((item) => `
              <article class="panel capital-runway-card">
                <span>${escapeHtml(item.step)}</span>
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.detail)}</p>
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[7])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content capital-shell">
          <article class="capital-closing-board">
            <span class="eyebrow">${escapeHtml(timeline?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(timeline?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(timeline?.body ?? "")}</p>
            <div class="capital-evidence-list">
              ${closingRows.map((item) => `<div class="capital-evidence-row"><span>${escapeHtml(item.label)}</span><div><p>${escapeHtml(item.detail)}</p></div></div>`).join("")}
            </div>
          </article>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[8])}
        </div>
      </section>
    `,
  ].join("\n")
}

function renderHomeDesignTrendsSlides(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const cover = getVariantSlideByLayout(variant, "cover")
  const agenda = getVariantSlideByLayout(variant, "agenda")
  const insight = getVariantSlideByLayout(variant, "insight")
  const comparison = getVariantSlideByLayout(variant, "comparison")
  const evidence = getVariantSlideByLayout(variant, "evidence")
  const stats = getVariantSlideByLayout(variant, "stats")
  const chart = getVariantSlideByLayout(variant, "chart")
  const process = getVariantSlideByLayout(variant, "process")
  const timeline = getVariantSlideByLayout(variant, "timeline")
  const variantOutline = variant.outline ?? deck.outline
  const agendaRows = getContentsRows(agenda, variantOutline)
  const comparisonRows = getComparisonRows(comparison)
  const spotlightRows = getSpotlightRows(evidence)
  const statsRows = getMetricRows(stats)
  const chartRows = deriveChartRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: chart,
    comparisonRows,
    statsRows,
    spotlightRows,
  })
  const processRows = deriveProcessRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: process,
    closingRows: getClosingRows(timeline),
    agendaRows,
    spotlightRows,
  })
  const closingRows = getClosingRows(timeline)

  return [
    `
      <section class="slide home-cover">
        <div class="slide-content home-shell">
          <div class="home-masthead">
            <span class="home-badge">${escapeHtml(cover?.kicker ?? variant.name)}</span>
            <span class="home-date">${escapeHtml(buildDeckDateStamp(deck.generatedAt))}</span>
          </div>
          <div class="home-hero-spread">
            ${renderWorkflowImageFigure(cover, "cover")}
            <article class="home-copy-card">
              <h1 class="title">${escapeHtml(cover?.title ?? deck.title)}</h1>
              <p class="subtitle">${escapeHtml(cover?.body ?? "")}</p>
              <div class="home-chip-row">
                ${(cover?.bullets ?? []).slice(0, 4).map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}
              </div>
            </article>
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[0])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content home-shell">
          <div class="home-section-head">
            <span class="eyebrow">${escapeHtml(agenda?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(agenda?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(agenda?.body ?? "")}</p>
          </div>
          <div class="home-tile-grid">
            ${agendaRows.map((item) => `
              <article class="home-tile-card">
                <span>${escapeHtml(item.index)}</span>
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.detail)}</p>
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[1])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content home-shell">
          <div class="home-story-spread">
            <article class="home-copy-card">
              <span class="eyebrow">${escapeHtml(insight?.kicker ?? "")}</span>
              <h2 class="title">${escapeHtml(insight?.title ?? "")}</h2>
              <p class="subtitle">${escapeHtml(insight?.body ?? "")}</p>
              <div class="home-note-list">
                ${(insight?.bullets ?? []).slice(0, 4).map((bullet, index) => `<div><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(bullet)}</p></div>`).join("")}
              </div>
            </article>
            ${renderWorkflowImageFigure(insight, "cover")}
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[2])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content home-shell">
          <div class="home-section-head">
            <span class="eyebrow">${escapeHtml(comparison?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(comparison?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(comparison?.body ?? "")}</p>
          </div>
          <div class="home-compare-grid">
            ${comparisonRows.map((item) => `
              <article class="home-compare-card">
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(item.title)}</strong>
                <p>${escapeHtml(item.detail)}</p>
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[3])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content home-shell">
          <div class="home-curation-strip">
            ${spotlightRows.map((item, index) => `
              <article class="home-curation-card">
                <span>${String(index + 1).padStart(2, "0")}</span>
                <strong>${escapeHtml(item.title)}</strong>
                <p>${escapeHtml(item.detail)}</p>
              </article>`).join("")}
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[4])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content home-shell">
          <div class="home-metric-row">
            ${statsRows.map((item) => `
              <article class="home-metric-card">
                <span class="home-metric-value">${escapeHtml(item.value)}</span>
                <strong>${escapeHtml(item.label)}</strong>
                ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[5])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content home-shell">
          <div class="home-section-head">
            <span class="eyebrow">${escapeHtml(chart?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(chart?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(chart?.body ?? "")}</p>
          </div>
          <div class="home-trend-rows">
            ${chartRows.map((item) => `
              <article class="home-trend-row">
                <div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.detail)}</p></div>
                <div class="home-trend-track"><i style="width:${Math.max(24, Math.min(96, item.value))}%"></i></div>
              </article>`).join("")}
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[6])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content home-shell">
          <div class="home-sequence-grid">
            ${processRows.map((item) => `
              <article class="home-sequence-card">
                <span>${escapeHtml(item.step)}</span>
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.detail)}</p>
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[7])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content home-shell">
          <article class="home-closing-card">
            <span class="eyebrow">${escapeHtml(timeline?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(timeline?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(timeline?.body ?? "")}</p>
            <div class="home-note-list">
              ${closingRows.map((item) => `<div><span>${escapeHtml(item.label)}</span><p>${escapeHtml(item.detail)}</p></div>`).join("")}
            </div>
          </article>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[8])}
        </div>
      </section>
    `,
  ].join("\n")
}

function renderLinHuiyinArchitectSlides(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const cover = getVariantSlideByLayout(variant, "cover")
  const agenda = getVariantSlideByLayout(variant, "agenda")
  const insight = getVariantSlideByLayout(variant, "insight")
  const comparison = getVariantSlideByLayout(variant, "comparison")
  const evidence = getVariantSlideByLayout(variant, "evidence")
  const stats = getVariantSlideByLayout(variant, "stats")
  const chart = getVariantSlideByLayout(variant, "chart")
  const process = getVariantSlideByLayout(variant, "process")
  const timeline = getVariantSlideByLayout(variant, "timeline")
  const variantOutline = variant.outline ?? deck.outline
  const coverPoints = (cover?.bullets ?? []).slice(0, 4)
  const agendaRows = getContentsRows(agenda, variantOutline)
  const comparisonRows = getComparisonRows(comparison)
  const spotlightRows = getSpotlightRows(evidence)
  const statsRows = getMetricRows(stats)
  const chartRows = deriveChartRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: chart,
    comparisonRows,
    statsRows,
    spotlightRows,
  })
  const processRows = deriveProcessRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: process,
    closingRows: getClosingRows(timeline),
    agendaRows,
    spotlightRows,
  })
  const closingRows = getClosingRows(timeline)

  return [
    `
      <section class="slide heritage-cover">
        <div class="slide-content heritage-shell">
          <div class="heritage-masthead">
            <span class="heritage-chip">${escapeHtml(cover?.kicker ?? variant.name)}</span>
            <span class="heritage-date">${escapeHtml(buildDeckDateStamp(deck.generatedAt))}</span>
          </div>
          <div class="heritage-hero-spread">
            <article class="heritage-title-card">
              <h1 class="title">${escapeHtml(cover?.title ?? deck.title)}</h1>
              <p class="subtitle">${escapeHtml(cover?.body ?? "")}</p>
              <div class="heritage-quote-tags">
                ${coverPoints.map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}
              </div>
            </article>
            ${renderWorkflowImageFigure(cover, "cover")}
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[0])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content heritage-shell">
          <div class="heritage-section-head">
            <span class="eyebrow">${escapeHtml(agenda?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(agenda?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(agenda?.body ?? "")}</p>
          </div>
          <div class="heritage-index-columns">
            ${agendaRows.map((item) => `
              <article class="heritage-index-row">
                <span>${escapeHtml(item.index)}</span>
                <div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div>
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[1])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content heritage-shell">
          <div class="heritage-story-board">
            ${renderWorkflowImageFigure(insight, "cover")}
            <article class="heritage-note-card">
              <span class="eyebrow">${escapeHtml(insight?.kicker ?? "")}</span>
              <h2 class="title">${escapeHtml(insight?.title ?? "")}</h2>
              <p class="subtitle">${escapeHtml(insight?.body ?? "")}</p>
              <div class="heritage-note-list">
                ${(insight?.bullets ?? []).slice(0, 4).map((bullet, index) => `<div><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(bullet)}</p></div>`).join("")}
              </div>
            </article>
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[2])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content heritage-shell">
          <div class="heritage-section-head">
            <span class="eyebrow">${escapeHtml(comparison?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(comparison?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(comparison?.body ?? "")}</p>
          </div>
          <div class="heritage-compare-columns">
            ${comparisonRows.map((item) => `
              <article class="heritage-compare-card">
                <span>${escapeHtml(item.label)}</span>
                <strong>${escapeHtml(item.title)}</strong>
                <p>${escapeHtml(item.detail)}</p>
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[3])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content heritage-shell">
          <div class="heritage-evidence-stack">
            ${spotlightRows.map((item, index) => `
              <article class="heritage-evidence-card">
                <span>${String(index + 1).padStart(2, "0")}</span>
                <div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div>
              </article>`).join("")}
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[4])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content heritage-shell">
          <div class="heritage-metric-columns">
            ${statsRows.map((item) => `
              <article class="heritage-metric-card">
                <span class="heritage-metric-value">${escapeHtml(item.value)}</span>
                <strong>${escapeHtml(item.label)}</strong>
                ${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[5])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content heritage-shell">
          <div class="heritage-section-head">
            <span class="eyebrow">${escapeHtml(chart?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(chart?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(chart?.body ?? "")}</p>
          </div>
          <div class="heritage-ledger-lines">
            ${chartRows.map((item) => `
              <article class="heritage-ledger-row">
                <div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.detail)}</p></div>
                <div class="heritage-ledger-track"><i style="width:${Math.max(24, Math.min(96, item.value))}%"></i></div>
              </article>`).join("")}
          </div>
          ${renderFooter(variant.name, NINE_PAGE_PROGRESS[6])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content heritage-shell">
          <div class="heritage-runway-columns">
            ${processRows.map((item) => `
              <article class="heritage-runway-card">
                <span>${escapeHtml(item.step)}</span>
                <h3>${escapeHtml(item.title)}</h3>
                <p>${escapeHtml(item.detail)}</p>
              </article>`).join("")}
          </div>
          ${renderFooter(deck.title, NINE_PAGE_PROGRESS[7])}
        </div>
      </section>
    `,
    `
      <section class="slide">
        <div class="slide-content heritage-shell">
          <article class="heritage-closing-card">
            <span class="eyebrow">${escapeHtml(timeline?.kicker ?? "")}</span>
            <h2 class="title">${escapeHtml(timeline?.title ?? "")}</h2>
            <p class="subtitle">${escapeHtml(timeline?.body ?? "")}</p>
            <div class="heritage-note-list">
              ${closingRows.map((item) => `<div><span>${escapeHtml(item.label)}</span><p>${escapeHtml(item.detail)}</p></div>`).join("")}
            </div>
          </article>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[8])}
        </div>
      </section>
    `,
  ].join("\n")
}

function renderBuildingEffectiveAgentsSlides(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const cover = getVariantSlideByLayout(variant, "cover")
  const agenda = getVariantSlideByLayout(variant, "agenda")
  const insight = getVariantSlideByLayout(variant, "insight")
  const comparison = getVariantSlideByLayout(variant, "comparison")
  const evidence = getVariantSlideByLayout(variant, "evidence")
  const stats = getVariantSlideByLayout(variant, "stats")
  const chart = getVariantSlideByLayout(variant, "chart")
  const process = getVariantSlideByLayout(variant, "process")
  const timeline = getVariantSlideByLayout(variant, "timeline")
  const variantOutline = variant.outline ?? deck.outline
  const coverPoints = (cover?.bullets ?? []).slice(0, 4)
  const agendaRows = getContentsRows(agenda, variantOutline)
  const comparisonRows = getComparisonRows(comparison)
  const spotlightRows = getSpotlightRows(evidence)
  const statsRows = getMetricRows(stats)
  const chartRows = deriveChartRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: chart,
    comparisonRows,
    statsRows,
    spotlightRows,
  })
  const processRows = deriveProcessRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: process,
    closingRows: getClosingRows(timeline),
    agendaRows,
    spotlightRows,
  })
  const closingRows = getClosingRows(timeline)

  return [
    `
      <section class="slide agents-cover">
        <div class="slide-content agents-shell">
          <div class="agents-ruler">
            <span>${escapeHtml(cover?.kicker ?? variant.name)}</span>
            <span>${escapeHtml(buildDeckDateStamp(deck.generatedAt))}</span>
          </div>
          <div class="agents-hero-grid">
            <article class="agents-hero-card">
              <h1 class="title">${escapeHtml(cover?.title ?? deck.title)}</h1>
              <p class="subtitle">${escapeHtml(cover?.body ?? "")}</p>
              <div class="agents-token-row">
                ${coverPoints.map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}
              </div>
            </article>
            <aside class="agents-capability-board">
              ${coverPoints.map((bullet, index) => `
                <div class="agents-capability-row">
                  <span>${String(index + 1).padStart(2, "0")}</span>
                  <p>${escapeHtml(bullet)}</p>
                </div>`).join("")}
            </aside>
          </div>
          ${renderFooter(variant.summary, NINE_PAGE_PROGRESS[0])}
        </div>
      </section>
    `,
    `
      <section class="slide"><div class="slide-content agents-shell"><div class="agents-section-head"><span class="eyebrow">${escapeHtml(agenda?.kicker ?? "")}</span><h2 class="title">${escapeHtml(agenda?.title ?? "")}</h2><p class="subtitle">${escapeHtml(agenda?.body ?? "")}</p></div><div class="agents-module-grid">${agendaRows.map((item) => `<article class="agents-module-card"><span>${escapeHtml(item.index)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p></article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[1])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content agents-shell"><div class="agents-thesis-panel"><span class="eyebrow">${escapeHtml(insight?.kicker ?? "")}</span><h2 class="title">${escapeHtml(insight?.title ?? "")}</h2><p class="subtitle">${escapeHtml(insight?.body ?? "")}</p><div class="agents-proof-list">${(insight?.bullets ?? []).slice(0, 4).map((bullet, index) => `<div><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(bullet)}</p></div>`).join("")}</div></div>${renderFooter(variant.name, NINE_PAGE_PROGRESS[2])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content agents-shell"><div class="agents-compare-board">${comparisonRows.map((item) => `<article class="agents-compare-card"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[3])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content agents-shell"><div class="agents-signal-lane">${spotlightRows.map((item, index) => `<article class="agents-signal-card"><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div></article>`).join("")}</div>${renderFooter(variant.summary, NINE_PAGE_PROGRESS[4])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content agents-shell"><div class="agents-metric-grid">${statsRows.map((item) => `<article class="agents-metric-card"><span class="agents-metric-value">${escapeHtml(item.value)}</span><strong>${escapeHtml(item.label)}</strong>${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}</article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[5])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content agents-shell"><div class="agents-graph-stack">${chartRows.map((item) => `<article class="agents-graph-row"><div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.detail)}</p></div><div class="agents-graph-track"><i style="width:${Math.max(24, Math.min(96, item.value))}%"></i></div></article>`).join("")}</div>${renderFooter(variant.name, NINE_PAGE_PROGRESS[6])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content agents-shell"><div class="agents-runway-grid">${processRows.map((item) => `<article class="agents-runway-card"><span>${escapeHtml(item.step)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p></article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[7])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content agents-shell"><article class="agents-closing-card"><span class="eyebrow">${escapeHtml(timeline?.kicker ?? "")}</span><h2 class="title">${escapeHtml(timeline?.title ?? "")}</h2><p class="subtitle">${escapeHtml(timeline?.body ?? "")}</p><div class="agents-proof-list">${closingRows.map((item) => `<div><span>${escapeHtml(item.label)}</span><p>${escapeHtml(item.detail)}</p></div>`).join("")}</div></article>${renderFooter(variant.summary, NINE_PAGE_PROGRESS[8])}</div></section>
    `,
  ].join("\n")
}

function renderCangzhuoMemoSlides(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const cover = getVariantSlideByLayout(variant, "cover")
  const agenda = getVariantSlideByLayout(variant, "agenda")
  const insight = getVariantSlideByLayout(variant, "insight")
  const comparison = getVariantSlideByLayout(variant, "comparison")
  const evidence = getVariantSlideByLayout(variant, "evidence")
  const stats = getVariantSlideByLayout(variant, "stats")
  const chart = getVariantSlideByLayout(variant, "chart")
  const process = getVariantSlideByLayout(variant, "process")
  const timeline = getVariantSlideByLayout(variant, "timeline")
  const variantOutline = variant.outline ?? deck.outline
  const agendaRows = getContentsRows(agenda, variantOutline)
  const comparisonRows = getComparisonRows(comparison)
  const spotlightRows = getSpotlightRows(evidence)
  const statsRows = getMetricRows(stats)
  const chartRows = deriveChartRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: chart,
    comparisonRows,
    statsRows,
    spotlightRows,
  })
  const processRows = deriveProcessRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: process,
    closingRows: getClosingRows(timeline),
    agendaRows,
    spotlightRows,
  })
  const closingRows = getClosingRows(timeline)

  return [
    `
      <section class="slide memo-cover"><div class="slide-content memo-shell"><div class="memo-header"><span class="memo-seal">${escapeHtml(cover?.kicker ?? variant.name)}</span><span class="memo-date">${escapeHtml(buildDeckDateStamp(deck.generatedAt))}</span></div><article class="memo-hero-card"><h1 class="title">${escapeHtml(cover?.title ?? deck.title)}</h1><p class="subtitle">${escapeHtml(cover?.body ?? "")}</p><div class="memo-bullet-strip">${(cover?.bullets ?? []).slice(0, 4).map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}</div></article>${renderFooter(variant.summary, NINE_PAGE_PROGRESS[0])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content memo-shell"><div class="memo-list-board">${agendaRows.map((item) => `<article class="memo-list-row"><span>${escapeHtml(item.index)}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div></article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[1])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content memo-shell"><article class="memo-decision-card"><span class="eyebrow">${escapeHtml(insight?.kicker ?? "")}</span><h2 class="title">${escapeHtml(insight?.title ?? "")}</h2><p class="subtitle">${escapeHtml(insight?.body ?? "")}</p><div class="memo-note-stack">${(insight?.bullets ?? []).slice(0, 4).map((bullet, index) => `<div><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(bullet)}</p></div>`).join("")}</div></article>${renderFooter(variant.name, NINE_PAGE_PROGRESS[2])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content memo-shell"><div class="memo-compare-grid">${comparisonRows.map((item) => `<article class="memo-compare-card"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[3])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content memo-shell"><div class="memo-risk-list">${spotlightRows.map((item, index) => `<article class="memo-risk-row"><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div></article>`).join("")}</div>${renderFooter(variant.summary, NINE_PAGE_PROGRESS[4])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content memo-shell"><div class="memo-metric-strip">${statsRows.map((item) => `<article class="memo-metric-card"><span class="memo-metric-value">${escapeHtml(item.value)}</span><strong>${escapeHtml(item.label)}</strong>${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}</article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[5])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content memo-shell"><div class="memo-chart-list">${chartRows.map((item) => `<article class="memo-chart-row"><div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.detail)}</p></div><div class="memo-chart-track"><i style="width:${Math.max(24, Math.min(96, item.value))}%"></i></div></article>`).join("")}</div>${renderFooter(variant.name, NINE_PAGE_PROGRESS[6])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content memo-shell"><div class="memo-action-grid">${processRows.map((item) => `<article class="memo-action-card"><span>${escapeHtml(item.step)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p></article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[7])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content memo-shell"><article class="memo-closing-card"><span class="eyebrow">${escapeHtml(timeline?.kicker ?? "")}</span><h2 class="title">${escapeHtml(timeline?.title ?? "")}</h2><p class="subtitle">${escapeHtml(timeline?.body ?? "")}</p><div class="memo-note-stack">${closingRows.map((item) => `<div><span>${escapeHtml(item.label)}</span><p>${escapeHtml(item.detail)}</p></div>`).join("")}</div></article>${renderFooter(variant.summary, NINE_PAGE_PROGRESS[8])}</div></section>
    `,
  ].join("\n")
}

function renderGeneralDarkTechSlides(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const cover = getVariantSlideByLayout(variant, "cover")
  const agenda = getVariantSlideByLayout(variant, "agenda")
  const insight = getVariantSlideByLayout(variant, "insight")
  const comparison = getVariantSlideByLayout(variant, "comparison")
  const evidence = getVariantSlideByLayout(variant, "evidence")
  const stats = getVariantSlideByLayout(variant, "stats")
  const chart = getVariantSlideByLayout(variant, "chart")
  const process = getVariantSlideByLayout(variant, "process")
  const timeline = getVariantSlideByLayout(variant, "timeline")
  const variantOutline = variant.outline ?? deck.outline
  const coverPoints = (cover?.bullets ?? []).slice(0, 4)
  const agendaRows = getContentsRows(agenda, variantOutline)
  const comparisonRows = getComparisonRows(comparison)
  const spotlightRows = getSpotlightRows(evidence)
  const statsRows = getMetricRows(stats)
  const chartRows = deriveChartRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: chart,
    comparisonRows,
    statsRows,
    spotlightRows,
  })
  const processRows = deriveProcessRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: process,
    closingRows: getClosingRows(timeline),
    agendaRows,
    spotlightRows,
  })
  const closingRows = getClosingRows(timeline)

  return [
    `
      <section class="slide darktech-cover"><div class="slide-content darktech-shell"><div class="darktech-topbar"><span>${escapeHtml(cover?.kicker ?? variant.name)}</span><span>${escapeHtml(buildDeckDateStamp(deck.generatedAt))}</span></div><div class="darktech-hero-grid"><article class="darktech-hero-card"><h1 class="title">${escapeHtml(cover?.title ?? deck.title)}</h1><p class="subtitle">${escapeHtml(cover?.body ?? "")}</p><div class="darktech-tag-strip">${coverPoints.map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}</div></article><aside class="darktech-status-card">${coverPoints.map((bullet, index) => `<div class="darktech-status-row"><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(bullet)}</p></div>`).join("")}</aside></div>${renderFooter(variant.summary, NINE_PAGE_PROGRESS[0])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content darktech-shell"><div class="darktech-node-grid">${agendaRows.map((item) => `<article class="darktech-node-card"><span>${escapeHtml(item.index)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p></article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[1])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content darktech-shell"><article class="darktech-thesis-card"><span class="eyebrow">${escapeHtml(insight?.kicker ?? "")}</span><h2 class="title">${escapeHtml(insight?.title ?? "")}</h2><p class="subtitle">${escapeHtml(insight?.body ?? "")}</p><div class="darktech-proof-grid">${(insight?.bullets ?? []).slice(0, 4).map((bullet, index) => `<div><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(bullet)}</p></div>`).join("")}</div></article>${renderFooter(variant.name, NINE_PAGE_PROGRESS[2])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content darktech-shell"><div class="darktech-compare-grid">${comparisonRows.map((item) => `<article class="darktech-compare-card"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[3])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content darktech-shell"><div class="darktech-alert-lane">${spotlightRows.map((item, index) => `<article class="darktech-alert-card"><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div></article>`).join("")}</div>${renderFooter(variant.summary, NINE_PAGE_PROGRESS[4])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content darktech-shell"><div class="darktech-metric-grid">${statsRows.map((item) => `<article class="darktech-metric-card"><span class="darktech-metric-value">${escapeHtml(item.value)}</span><strong>${escapeHtml(item.label)}</strong>${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}</article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[5])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content darktech-shell"><div class="darktech-scan-list">${chartRows.map((item) => `<article class="darktech-scan-row"><div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.detail)}</p></div><div class="darktech-scan-track"><i style="width:${Math.max(24, Math.min(96, item.value))}%"></i></div></article>`).join("")}</div>${renderFooter(variant.name, NINE_PAGE_PROGRESS[6])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content darktech-shell"><div class="darktech-run-grid">${processRows.map((item) => `<article class="darktech-run-card"><span>${escapeHtml(item.step)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p></article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[7])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content darktech-shell"><article class="darktech-close-card"><span class="eyebrow">${escapeHtml(timeline?.kicker ?? "")}</span><h2 class="title">${escapeHtml(timeline?.title ?? "")}</h2><p class="subtitle">${escapeHtml(timeline?.body ?? "")}</p><div class="darktech-proof-grid">${closingRows.map((item) => `<div><span>${escapeHtml(item.label)}</span><p>${escapeHtml(item.detail)}</p></div>`).join("")}</div></article>${renderFooter(variant.summary, NINE_PAGE_PROGRESS[8])}</div></section>
    `,
  ].join("\n")
}

function renderHighRiseRenewalSlides(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const cover = getVariantSlideByLayout(variant, "cover")
  const agenda = getVariantSlideByLayout(variant, "agenda")
  const insight = getVariantSlideByLayout(variant, "insight")
  const comparison = getVariantSlideByLayout(variant, "comparison")
  const evidence = getVariantSlideByLayout(variant, "evidence")
  const stats = getVariantSlideByLayout(variant, "stats")
  const chart = getVariantSlideByLayout(variant, "chart")
  const process = getVariantSlideByLayout(variant, "process")
  const timeline = getVariantSlideByLayout(variant, "timeline")
  const variantOutline = variant.outline ?? deck.outline
  const coverPoints = (cover?.bullets ?? []).slice(0, 4)
  const agendaRows = getContentsRows(agenda, variantOutline)
  const comparisonRows = getComparisonRows(comparison)
  const spotlightRows = getSpotlightRows(evidence)
  const statsRows = getMetricRows(stats)
  const chartRows = deriveChartRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: chart,
    comparisonRows,
    statsRows,
    spotlightRows,
  })
  const processRows = deriveProcessRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: process,
    closingRows: getClosingRows(timeline),
    agendaRows,
    spotlightRows,
  })
  const closingRows = getClosingRows(timeline)

  return [
    `
      <section class="slide renewal-cover"><div class="slide-content renewal-shell"><div class="renewal-topbar"><span>${escapeHtml(cover?.kicker ?? variant.name)}</span><span>${escapeHtml(buildDeckDateStamp(deck.generatedAt))}</span></div><div class="renewal-hero-board">${renderWorkflowImageFigure(cover, "cover")}<article class="renewal-copy-card"><h1 class="title">${escapeHtml(cover?.title ?? deck.title)}</h1><p class="subtitle">${escapeHtml(cover?.body ?? "")}</p><div class="renewal-tagline">${coverPoints.map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}</div></article></div>${renderFooter(variant.summary, NINE_PAGE_PROGRESS[0])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content renewal-shell"><div class="renewal-plan-grid">${agendaRows.map((item) => `<article class="renewal-plan-card"><span>${escapeHtml(item.index)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p></article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[1])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content renewal-shell"><article class="renewal-thesis-card"><span class="eyebrow">${escapeHtml(insight?.kicker ?? "")}</span><h2 class="title">${escapeHtml(insight?.title ?? "")}</h2><p class="subtitle">${escapeHtml(insight?.body ?? "")}</p><div class="renewal-note-columns">${(insight?.bullets ?? []).slice(0, 4).map((bullet, index) => `<div><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(bullet)}</p></div>`).join("")}</div></article>${renderFooter(variant.name, NINE_PAGE_PROGRESS[2])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content renewal-shell"><div class="renewal-material-grid">${comparisonRows.map((item) => `<article class="renewal-material-card"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[3])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content renewal-shell"><div class="renewal-evidence-strip">${spotlightRows.map((item, index) => `<article class="renewal-evidence-card"><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div></article>`).join("")}</div>${renderFooter(variant.summary, NINE_PAGE_PROGRESS[4])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content renewal-shell"><div class="renewal-metric-row">${statsRows.map((item) => `<article class="renewal-metric-card"><span class="renewal-metric-value">${escapeHtml(item.value)}</span><strong>${escapeHtml(item.label)}</strong>${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}</article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[5])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content renewal-shell"><div class="renewal-ledger-rows">${chartRows.map((item) => `<article class="renewal-ledger-row"><div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.detail)}</p></div><div class="renewal-ledger-track"><i style="width:${Math.max(24, Math.min(96, item.value))}%"></i></div></article>`).join("")}</div>${renderFooter(variant.name, NINE_PAGE_PROGRESS[6])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content renewal-shell"><div class="renewal-phase-grid">${processRows.map((item) => `<article class="renewal-phase-card"><span>${escapeHtml(item.step)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p></article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[7])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content renewal-shell"><article class="renewal-closing-card"><span class="eyebrow">${escapeHtml(timeline?.kicker ?? "")}</span><h2 class="title">${escapeHtml(timeline?.title ?? "")}</h2><p class="subtitle">${escapeHtml(timeline?.body ?? "")}</p><div class="renewal-note-columns">${closingRows.map((item) => `<div><span>${escapeHtml(item.label)}</span><p>${escapeHtml(item.detail)}</p></div>`).join("")}</div></article>${renderFooter(variant.summary, NINE_PAGE_PROGRESS[8])}</div></section>
    `,
  ].join("\n")
}

function renderKimsoongLoyaltySlides(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const cover = getVariantSlideByLayout(variant, "cover")
  const agenda = getVariantSlideByLayout(variant, "agenda")
  const insight = getVariantSlideByLayout(variant, "insight")
  const comparison = getVariantSlideByLayout(variant, "comparison")
  const evidence = getVariantSlideByLayout(variant, "evidence")
  const stats = getVariantSlideByLayout(variant, "stats")
  const chart = getVariantSlideByLayout(variant, "chart")
  const process = getVariantSlideByLayout(variant, "process")
  const timeline = getVariantSlideByLayout(variant, "timeline")
  const variantOutline = variant.outline ?? deck.outline
  const coverPoints = (cover?.bullets ?? []).slice(0, 4)
  const agendaRows = getContentsRows(agenda, variantOutline)
  const comparisonRows = getComparisonRows(comparison)
  const spotlightRows = getSpotlightRows(evidence)
  const statsRows = getMetricRows(stats)
  const chartRows = deriveChartRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: chart,
    comparisonRows,
    statsRows,
    spotlightRows,
  })
  const processRows = deriveProcessRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: process,
    closingRows: getClosingRows(timeline),
    agendaRows,
    spotlightRows,
  })
  const closingRows = getClosingRows(timeline)

  return [
    `
      <section class="slide loyalty-cover"><div class="slide-content loyalty-shell"><div class="loyalty-header"><span>${escapeHtml(cover?.kicker ?? variant.name)}</span><span>${escapeHtml(buildDeckDateStamp(deck.generatedAt))}</span></div><div class="loyalty-hero-grid"><article class="loyalty-hero-card"><h1 class="title">${escapeHtml(cover?.title ?? deck.title)}</h1><p class="subtitle">${escapeHtml(cover?.body ?? "")}</p><div class="loyalty-chip-row">${coverPoints.map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}</div></article><aside class="loyalty-benefit-card">${coverPoints.map((bullet, index) => `<div class="loyalty-benefit-row"><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(bullet)}</p></div>`).join("")}</aside></div>${renderFooter(variant.summary, NINE_PAGE_PROGRESS[0])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content loyalty-shell"><div class="loyalty-member-grid">${agendaRows.map((item) => `<article class="loyalty-member-card"><span>${escapeHtml(item.index)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p></article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[1])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content loyalty-shell"><article class="loyalty-story-card"><span class="eyebrow">${escapeHtml(insight?.kicker ?? "")}</span><h2 class="title">${escapeHtml(insight?.title ?? "")}</h2><p class="subtitle">${escapeHtml(insight?.body ?? "")}</p><div class="loyalty-note-stack">${(insight?.bullets ?? []).slice(0, 4).map((bullet, index) => `<div><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(bullet)}</p></div>`).join("")}</div></article>${renderFooter(variant.name, NINE_PAGE_PROGRESS[2])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content loyalty-shell"><div class="loyalty-tier-grid">${comparisonRows.map((item) => `<article class="loyalty-tier-card"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[3])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content loyalty-shell"><div class="loyalty-proof-strip">${spotlightRows.map((item, index) => `<article class="loyalty-proof-card"><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div></article>`).join("")}</div>${renderFooter(variant.summary, NINE_PAGE_PROGRESS[4])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content loyalty-shell"><div class="loyalty-metric-row">${statsRows.map((item) => `<article class="loyalty-metric-card"><span class="loyalty-metric-value">${escapeHtml(item.value)}</span><strong>${escapeHtml(item.label)}</strong>${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}</article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[5])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content loyalty-shell"><div class="loyalty-chart-list">${chartRows.map((item) => `<article class="loyalty-chart-row"><div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.detail)}</p></div><div class="loyalty-chart-track"><i style="width:${Math.max(24, Math.min(96, item.value))}%"></i></div></article>`).join("")}</div>${renderFooter(variant.name, NINE_PAGE_PROGRESS[6])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content loyalty-shell"><div class="loyalty-journey-grid">${processRows.map((item) => `<article class="loyalty-journey-card"><span>${escapeHtml(item.step)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p></article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[7])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content loyalty-shell"><article class="loyalty-closing-card"><span class="eyebrow">${escapeHtml(timeline?.kicker ?? "")}</span><h2 class="title">${escapeHtml(timeline?.title ?? "")}</h2><p class="subtitle">${escapeHtml(timeline?.body ?? "")}</p><div class="loyalty-note-stack">${closingRows.map((item) => `<div><span>${escapeHtml(item.label)}</span><p>${escapeHtml(item.detail)}</p></div>`).join("")}</div></article>${renderFooter(variant.summary, NINE_PAGE_PROGRESS[8])}</div></section>
    `,
  ].join("\n")
}

function renderLinHuiyinArchitectRevisedSlides(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const base = renderLinHuiyinArchitectSlides(deck, variant)
  return base.replaceAll("heritage-", "heritage-revised-").replaceAll("heritage ", "heritage-revised ")
}

function renderPlantDyeSlides(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const cover = getVariantSlideByLayout(variant, "cover")
  const agenda = getVariantSlideByLayout(variant, "agenda")
  const insight = getVariantSlideByLayout(variant, "insight")
  const comparison = getVariantSlideByLayout(variant, "comparison")
  const evidence = getVariantSlideByLayout(variant, "evidence")
  const stats = getVariantSlideByLayout(variant, "stats")
  const chart = getVariantSlideByLayout(variant, "chart")
  const process = getVariantSlideByLayout(variant, "process")
  const timeline = getVariantSlideByLayout(variant, "timeline")
  const variantOutline = variant.outline ?? deck.outline
  const coverPoints = (cover?.bullets ?? []).slice(0, 4)
  const agendaRows = getContentsRows(agenda, variantOutline)
  const comparisonRows = getComparisonRows(comparison)
  const spotlightRows = getSpotlightRows(evidence)
  const statsRows = getMetricRows(stats)
  const chartRows = deriveChartRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: chart,
    comparisonRows,
    statsRows,
    spotlightRows,
  })
  const processRows = deriveProcessRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: process,
    closingRows: getClosingRows(timeline),
    agendaRows,
    spotlightRows,
  })
  const closingRows = getClosingRows(timeline)

  return [
    `
      <section class="slide dye-cover"><div class="slide-content dye-shell"><div class="dye-masthead"><span>${escapeHtml(cover?.kicker ?? variant.name)}</span><span>${escapeHtml(buildDeckDateStamp(deck.generatedAt))}</span></div><div class="dye-hero-board">${renderWorkflowImageFigure(cover, "cover")}<article class="dye-copy-card"><h1 class="title">${escapeHtml(cover?.title ?? deck.title)}</h1><p class="subtitle">${escapeHtml(cover?.body ?? "")}</p><div class="dye-chip-row">${coverPoints.map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}</div></article></div>${renderFooter(variant.summary, NINE_PAGE_PROGRESS[0])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content dye-shell"><div class="dye-card-grid">${agendaRows.map((item) => `<article class="dye-card"><span>${escapeHtml(item.index)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p></article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[1])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content dye-shell"><article class="dye-story-card"><span class="eyebrow">${escapeHtml(insight?.kicker ?? "")}</span><h2 class="title">${escapeHtml(insight?.title ?? "")}</h2><p class="subtitle">${escapeHtml(insight?.body ?? "")}</p><div class="dye-note-list">${(insight?.bullets ?? []).slice(0, 4).map((bullet, index) => `<div><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(bullet)}</p></div>`).join("")}</div></article>${renderFooter(variant.name, NINE_PAGE_PROGRESS[2])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content dye-shell"><div class="dye-compare-grid">${comparisonRows.map((item) => `<article class="dye-compare-card"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[3])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content dye-shell"><div class="dye-spotlight-strip">${spotlightRows.map((item, index) => `<article class="dye-spotlight-card"><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div></article>`).join("")}</div>${renderFooter(variant.summary, NINE_PAGE_PROGRESS[4])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content dye-shell"><div class="dye-metric-row">${statsRows.map((item) => `<article class="dye-metric-card"><span class="dye-metric-value">${escapeHtml(item.value)}</span><strong>${escapeHtml(item.label)}</strong>${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}</article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[5])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content dye-shell"><div class="dye-trend-list">${chartRows.map((item) => `<article class="dye-trend-row"><div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.detail)}</p></div><div class="dye-trend-track"><i style="width:${Math.max(24, Math.min(96, item.value))}%"></i></div></article>`).join("")}</div>${renderFooter(variant.name, NINE_PAGE_PROGRESS[6])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content dye-shell"><div class="dye-phase-grid">${processRows.map((item) => `<article class="dye-phase-card"><span>${escapeHtml(item.step)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p></article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[7])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content dye-shell"><article class="dye-closing-card"><span class="eyebrow">${escapeHtml(timeline?.kicker ?? "")}</span><h2 class="title">${escapeHtml(timeline?.title ?? "")}</h2><p class="subtitle">${escapeHtml(timeline?.body ?? "")}</p><div class="dye-note-list">${closingRows.map((item) => `<div><span>${escapeHtml(item.label)}</span><p>${escapeHtml(item.detail)}</p></div>`).join("")}</div></article>${renderFooter(variant.summary, NINE_PAGE_PROGRESS[8])}</div></section>
    `,
  ].join("\n")
}

function renderLoraHuPortfolioSlides(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const cover = getVariantSlideByLayout(variant, "cover")
  const agenda = getVariantSlideByLayout(variant, "agenda")
  const insight = getVariantSlideByLayout(variant, "insight")
  const comparison = getVariantSlideByLayout(variant, "comparison")
  const evidence = getVariantSlideByLayout(variant, "evidence")
  const stats = getVariantSlideByLayout(variant, "stats")
  const chart = getVariantSlideByLayout(variant, "chart")
  const process = getVariantSlideByLayout(variant, "process")
  const timeline = getVariantSlideByLayout(variant, "timeline")
  const variantOutline = variant.outline ?? deck.outline
  const coverPoints = (cover?.bullets ?? []).slice(0, 4)
  const agendaRows = getContentsRows(agenda, variantOutline)
  const comparisonRows = getComparisonRows(comparison)
  const spotlightRows = getSpotlightRows(evidence)
  const statsRows = getMetricRows(stats)
  const chartRows = deriveChartRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: chart,
    comparisonRows,
    statsRows,
    spotlightRows,
  })
  const processRows = deriveProcessRowsFromTemplateFallbacks({
    styleKey: variant.styleKey,
    slide: process,
    closingRows: getClosingRows(timeline),
    agendaRows,
    spotlightRows,
  })
  const closingRows = getClosingRows(timeline)

  return [
    `
      <section class="slide creator-cover"><div class="slide-content creator-shell"><div class="creator-masthead"><span>${escapeHtml(cover?.kicker ?? variant.name)}</span><span>${escapeHtml(buildDeckDateStamp(deck.generatedAt))}</span></div><div class="creator-hero-spread">${renderWorkflowImageFigure(cover, "cover")}<article class="creator-copy-card"><h1 class="title">${escapeHtml(cover?.title ?? deck.title)}</h1><p class="subtitle">${escapeHtml(cover?.body ?? "")}</p><div class="creator-chip-row">${coverPoints.map((bullet) => `<span>${escapeHtml(bullet)}</span>`).join("")}</div></article></div>${renderFooter(variant.summary, NINE_PAGE_PROGRESS[0])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content creator-shell"><div class="creator-sheet-grid">${agendaRows.map((item) => `<article class="creator-sheet-card"><span>${escapeHtml(item.index)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p></article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[1])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content creator-shell"><article class="creator-story-card"><span class="eyebrow">${escapeHtml(insight?.kicker ?? "")}</span><h2 class="title">${escapeHtml(insight?.title ?? "")}</h2><p class="subtitle">${escapeHtml(insight?.body ?? "")}</p><div class="creator-note-list">${(insight?.bullets ?? []).slice(0, 4).map((bullet, index) => `<div><span>${String(index + 1).padStart(2, "0")}</span><p>${escapeHtml(bullet)}</p></div>`).join("")}</div></article>${renderFooter(variant.name, NINE_PAGE_PROGRESS[2])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content creator-shell"><div class="creator-compare-grid">${comparisonRows.map((item) => `<article class="creator-compare-card"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[3])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content creator-shell"><div class="creator-showcase-strip">${spotlightRows.map((item, index) => `<article class="creator-showcase-card"><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></div></article>`).join("")}</div>${renderFooter(variant.summary, NINE_PAGE_PROGRESS[4])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content creator-shell"><div class="creator-metric-row">${statsRows.map((item) => `<article class="creator-metric-card"><span class="creator-metric-value">${escapeHtml(item.value)}</span><strong>${escapeHtml(item.label)}</strong>${item.note ? `<p>${escapeHtml(item.note)}</p>` : ""}</article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[5])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content creator-shell"><div class="creator-ledger-list">${chartRows.map((item) => `<article class="creator-ledger-row"><div><strong>${escapeHtml(item.label)}</strong><p>${escapeHtml(item.detail)}</p></div><div class="creator-ledger-track"><i style="width:${Math.max(24, Math.min(96, item.value))}%"></i></div></article>`).join("")}</div>${renderFooter(variant.name, NINE_PAGE_PROGRESS[6])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content creator-shell"><div class="creator-sequence-grid">${processRows.map((item) => `<article class="creator-sequence-card"><span>${escapeHtml(item.step)}</span><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.detail)}</p></article>`).join("")}</div>${renderFooter(deck.title, NINE_PAGE_PROGRESS[7])}</div></section>
    `,
    `
      <section class="slide"><div class="slide-content creator-shell"><article class="creator-closing-card"><span class="eyebrow">${escapeHtml(timeline?.kicker ?? "")}</span><h2 class="title">${escapeHtml(timeline?.title ?? "")}</h2><p class="subtitle">${escapeHtml(timeline?.body ?? "")}</p><div class="creator-note-list">${closingRows.map((item) => `<div><span>${escapeHtml(item.label)}</span><p>${escapeHtml(item.detail)}</p></div>`).join("")}</div></article>${renderFooter(variant.summary, NINE_PAGE_PROGRESS[8])}</div></section>
    `,
  ].join("\n")
}

const CUSTOM_FRONTEND_SLIDES_RENDERERS = {
  ppt169_building_effective_agents: renderBuildingEffectiveAgentsSlides,
  ppt169_cangzhuo: renderCangzhuoMemoSlides,
  ppt169_general_dark_tech_claude_code_auto_mode: renderGeneralDarkTechSlides,
  ppt169_high_rise_renewal: renderHighRiseRenewalSlides,
  ppt169_kimsoong_loyalty_programme: renderKimsoongLoyaltySlides,
  ppt169_lin_huiyin_architect_revised: renderLinHuiyinArchitectRevisedSlides,
  ppt169_liziqi_plant_dye_colors: renderPlantDyeSlides,
  ppt169_lora_hu_2021: renderLoraHuPortfolioSlides,
  ppt169_glassmorphism_demo: renderGlassmorphismDemoSlides,
  ppt169_attention_is_all_you_need: renderAttentionResearchSlides,
  ppt169_indie_bookstore_zine_guide: renderIndieBookstoreZineSlides,
  ppt169_global_ai_capital_2026: renderGlobalAiCapitalSlides,
  ppt169_home_design_trends_2026: renderHomeDesignTrendsSlides,
  ppt169_lin_huiyin_architect: renderLinHuiyinArchitectSlides,
  ppt169_kubernetes_blueprint_2026: renderKubernetesBlueprintSlides,
  ppt169_image_text_showcase: renderImageTextShowcaseSlides,
  ppt169_fashion_weekly_digest: renderFashionWeeklyDigestSlides,
  ppt169_brutalist_ai_newspaper_2026: renderLongTableSlides,
  ppt169_sugar_rush_memphis: renderPlayfulSlides,
  ppt169_pritzker_2026: renderBroadsideSlides,
  ppt169_swiss_grid_systems: renderNeoGridBoldSlides,
}

const ARCHETYPE_FRONTEND_SLIDES_RENDERERS = {
  ppt169_brutalist_ai_newspaper_2026: renderLongTableSlides,
  ppt169_sugar_rush_memphis: renderPlayfulSlides,
  ppt169_pritzker_2026: renderBroadsideSlides,
  ppt169_building_effective_agents: renderBuildingEffectiveAgentsSlides,
  ppt169_swiss_grid_systems: renderNeoGridBoldSlides,
} satisfies Record<PptPreviewStyleArchetype, typeof renderLongTableSlides>

export function getCustomFrontendSlidesRendererKeys(): PptPreviewStyleKey[] {
  return getFrontendSlidesRendererKeys(CUSTOM_FRONTEND_SLIDES_RENDERERS)
}

function renderHtmlDocument(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const theme = getFrontendSlidesTheme(variant)
  const slides = renderFrontendSlidesVariant({
    deck,
    variant,
    customRenderers: CUSTOM_FRONTEND_SLIDES_RENDERERS,
    archetypeRenderers: ARCHETYPE_FRONTEND_SLIDES_RENDERERS,
  })

  return `<!DOCTYPE html>
<html lang="${escapeHtml(deck.language)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${escapeHtml(deck.title)} - ${escapeHtml(variant.name)}</title>
    ${theme.fontHref ? `<link href="${theme.fontHref}" rel="stylesheet" />` : ""}
    <style>
      ${FRONTEND_SLIDES_VIEWPORT_BASE_CSS}
      ${buildFrontendSlidesVariantCss(theme, variant.styleKey)}
    </style>
  </head>
  <body class="${theme.deckClass}">
    <main class="deck">
      ${slides}
    </main>
    <nav class="nav" aria-label="Presentation navigation">
      <button type="button" data-nav="prev" aria-label="Previous slide">Prev</button>
      <button type="button" data-nav="next" aria-label="Next slide">Next</button>
    </nav>
    <script>${buildFrontendSlidesControllerScript()}</script>
  </body>
</html>`
}

function materializeVariant(deck: PptPreviewDeck, variant: PptPreviewVariant) {
  const repairedVariant = repairVariantForRuntime(deck, variant)
  const html = renderHtmlDocument(deck, repairedVariant)
  const slides = repairedVariant.slides.map((slide, index) =>
    renderFrontendSlidesPosterAsset(deck, repairedVariant, slide, index),
  )

  return {
    ...repairedVariant,
    preview: {
      format: "svg" as const,
      themeId: repairedVariant.styleKey,
      cover: slides[0] ?? renderFrontendSlidesPosterAsset(deck, repairedVariant, repairedVariant.slides[0]!, 0),
      slides,
      htmlDocument: {
        fileName: buildPptExportFileName(deck, repairedVariant, "html"),
        html,
      },
    },
  }
}

export const frontendSlidesPreviewRuntime: LeadToolPptPreviewRuntime = {
  id: "frontend-slides-agent",
  renderKind: "html",
  async materializeStoryDeck(deck) {
    return storePptPreviewSessionDeck({
      ...deck,
      previewEngine: "frontend-slides-html" as const,
      previewSessionId: deck.previewSessionId ?? randomUUID(),
      variants: deck.variants.map((variant) => materializeVariant(deck, variant)),
    })
  },
}

export function buildFrontendSlidesPreviewDeck(deck: PptPreviewDeck): PptPreviewDeck {
  return {
    ...deck,
    previewEngine: "frontend-slides-html" as const,
    variants: deck.variants.map((variant) => materializeVariant(deck, variant)),
  }
}
