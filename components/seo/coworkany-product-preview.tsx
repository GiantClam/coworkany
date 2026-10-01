import Link from "next/link"
import Image from "next/image"
import { ArrowUpRight, Check, ChevronDown, FileText, Folder, Image as ImageIcon, Layers, Network, PenLine, Plus, Presentation, UserRound } from "lucide-react"

import type { CoworkanyHomeCopy, CoworkanyScenario } from "./coworkany-home-copy"
import styles from "./coworkany-home.module.css"

export function CoworkanyMark({ className = "" }: { className?: string }) {
  return <Image src="/brand/coworkany-icon.png" alt="" width={256} height={256} className={`${styles.mark} ${className}`} aria-hidden="true" />
}

export function WindowDots() {
  return <span className={styles.windowDots} aria-hidden="true"><i /><i /><i /></span>
}

export function HeroProductPreview({ copy, scenarios, startHref, onSelectScenario }: { copy: CoworkanyHomeCopy; scenarios: readonly CoworkanyScenario[]; startHref: string; onSelectScenario: (index: number) => void }) {
  const icons = [PenLine, Presentation, ImageIcon, Network]
  return (
    <div className={styles.productFrame}>
      <div className={styles.productWindow}>
        <div className={styles.windowBar}>
          <div><WindowDots /><span className={styles.miniBrand}><CoworkanyMark />coworkany</span></div>
          <span className={styles.exampleLabel}><FileText size={13} aria-hidden="true" />{copy.example}</span>
        </div>
        <div className={styles.productBody}>
          <aside className={styles.previewSidebar} aria-label={copy.workspace}>
            <span className={styles.sidebarCaption}>{copy.workspace}</span>
            <Link href={startHref} prefetch={false} className={styles.newTask}><Plus size={16} aria-hidden="true" />{copy.newTask}</Link>
            {scenarios.map((scenario, index) => {
              const Icon = icons[index]
              return <a href="#use-cases" key={scenario.id} onClick={() => onSelectScenario(index)}><Icon size={16} aria-hidden="true" />{scenario.label}</a>
            })}
            <span className={styles.personalSpace}><UserRound size={16} aria-hidden="true" />{copy.personal}<ChevronDown size={13} aria-hidden="true" /></span>
          </aside>
          <div className={styles.previewConversation}>
            <div className={styles.samplePrompt}>{copy.prompt}</div>
            <div className={styles.agentReply}>
              <CoworkanyMark />
              <div>
                <p>{copy.response}</p>
                <ol className={styles.checklist}>{copy.steps.map(step => <li key={step}><span><Check size={12} aria-hidden="true" /></span>{step}</li>)}</ol>
                <p className={styles.followup}>{copy.followup}</p>
              </div>
            </div>
          </div>
          <div className={styles.heroArtifact}>
            <div className={styles.artifactToolbar}><FileText size={13} aria-hidden="true" />{copy.document}<span>{copy.previewLabel}</span></div>
            <div className={styles.brandDocument}>
              <span><CoworkanyMark />coworkany</span>
              <strong>{copy.documentTitle[0]}<br />{copy.documentTitle[1]}</strong>
              <p>{copy.documentSubtitle}</p>
            </div>
            <div className={styles.documentSection}>
              <h3><span>01</span>{copy.documentSection}</h3><p>{copy.documentBody}</p>
            </div>
            <div className={styles.fileAttachment}><FileText size={18} aria-hidden="true" /><span>{copy.document}</span><Check size={14} aria-hidden="true" /></div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function ScenarioPreview({ scenario, copy }: { scenario: CoworkanyScenario; copy: CoworkanyHomeCopy }) {
  return (
    <div className={styles.scenarioFrame}>
      <div className={styles.scenarioWindow}>
        <aside className={styles.scenarioSteps}>
          <span className={styles.miniBrand}><CoworkanyMark />coworkany</span>
          <ol>{scenario.steps.map((step, i) => <li key={step}><span className={styles.stepCheck}><Check size={13} aria-hidden="true" /></span><span>{step}<small>0{i + 1}</small></span></li>)}</ol>
        </aside>
        <div className={styles.scenarioOutput}>
          <div className={styles.scenarioToolbar}><WindowDots /><span>{copy.previewLabel}</span></div>
          <div className={`${styles.outputContent} ${styles[scenario.id] || ""}`}>
            <span className={styles.outputLabel}>{scenario.label}</span>
            <h3>{scenario.outputTitle}</h3>
            <p>{scenario.outputBody}</p>
            {scenario.id === "writing" && <><div className={styles.documentLines} aria-hidden="true"><i /><i /><i /></div><p className={styles.outputFootnote}>{copy.followup}</p></>}
            {scenario.id === "slides" && <div className={styles.slideSequence} aria-hidden="true"><span>01 /</span><span>02 /</span><span>03 /</span></div>}
            {scenario.id === "images" && <div className={styles.coverSignature} aria-hidden="true"><CoworkanyMark /><span>coworkany<br />make room for ideas.</span></div>}
            {scenario.id === "workflows" && <div className={styles.workflowNodes}>{scenario.steps.map((step, i) => <div key={step}><span>{i === 0 ? <PenLine size={16} aria-hidden="true" /> : i === 1 ? <Layers size={16} aria-hidden="true" /> : <FileText size={16} aria-hidden="true" />}</span>{step}{i < 2 && <ArrowUpRight size={16} aria-hidden="true" />}</div>)}</div>}
          </div>
          <div className={styles.scenarioFile}><span>{copy.complete}</span><div><FileText size={22} aria-hidden="true" /><strong>{scenario.file}</strong><Check size={14} aria-hidden="true" /></div></div>
        </div>
      </div>
    </div>
  )
}

export function DesktopPreview({ copy }: { copy: CoworkanyHomeCopy }) {
  return (
    <div className={styles.desktopWindow}>
      <div className={styles.desktopToolbar}><WindowDots /><strong>{copy.myWorkspace}</strong><span>{copy.example}</span></div>
      <div className={styles.folderHeader}><span>{copy.fileName}</span><span>{copy.fileType}</span></div>
      {copy.folders.map(folder => <div className={styles.folderRow} key={folder}><Folder aria-hidden="true" /><span>{folder}</span><small>{copy.folderType}</small></div>)}
      <div className={styles.knowledgeRow}><Layers size={17} aria-hidden="true" /><span>{copy.knowledge}</span><Check size={15} aria-hidden="true" /></div>
      <div className={styles.localNote}><Folder size={14} aria-hidden="true" />{copy.local}</div>
    </div>
  )
}
