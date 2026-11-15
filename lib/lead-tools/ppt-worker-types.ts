export type PptWorkerRuntimeProfile = "local-dev" | "cloudflare-linux" | "railway-linux"

export type PptWorkerScenario = "marketing-campaign" | "product-launch" | "sales-deck" | "training"
export type PptWorkerLanguage = "zh-CN" | "en-US"
export type PptWorkerTemplateMode = "auto-4" | "single-template"
export type PptWorkerTemplateId = string
export type PptWorkerModelValue =
  | "MiniMax-M2.7-highspeed"
  | "MiniMax-M3"
  | "deepseek-v4-pro"
  | "deepseek-v4-flash"
  | "gpt-6-astra"
  | "gpt-6-luna"
  | "gpt-6-sol"
  | "gpt-6.1-sol"
  | "step-3.7-flash"
  | (string & {})
export type PptWorkerNarrativeAngle = "executive-brief" | "campaign-story" | "data-proof" | "action-plan"
export type PptWorkerResearchBrief = {
  topic: string
  keyFacts: string[]
  numericEvidence?: string[]
  risks?: string[]
  implications?: string[]
  sourceNotes?: string[]
  rawSummary?: string
}
export type PptWorkerInputImage = {
  url: string
  title?: string | null
  mimeType?: string | null
  sourceNodeKey?: string | null
  role?: "cover" | "content" | "logo" | "reference"
}

export type PptWorkerPreviewRequest = {
  requestId: string
  prompt: string
  researchBrief?: string | PptWorkerResearchBrief
  scenario: PptWorkerScenario
  language: PptWorkerLanguage
  model?: PptWorkerModelValue
  runtimeSlideModel?: string | null
  runtimeSlideProvider?: string | null
  templateMode?: PptWorkerTemplateMode
  templateId?: PptWorkerTemplateId
  narrativeAngle?: PptWorkerNarrativeAngle
  pageCount?: number | null
  images?: PptWorkerInputImage[]
  allowMockFallback: boolean
  runtimeProfile: PptWorkerRuntimeProfile
}

export type PptWorkerPreviewResponse = {
  previewSessionId: string
  generatedAt: string
  deck: unknown
}

export type PptWorkerPreviewJobStatus = "queued" | "running" | "completed" | "failed"

export type PptWorkerPreviewJobObservability = {
  updatedAt?: string
  heartbeatAt?: string
  leaseUntil?: string
  attemptCount?: number
}

export type PptWorkerPreviewSubmitResponse = {
  jobId: string
  status: Extract<PptWorkerPreviewJobStatus, "queued" | "running">
}

export type PptWorkerPreviewStatusResponse =
  | {
      jobId: string
      status: "queued" | "running"
    } & PptWorkerPreviewJobObservability
  | ({
      jobId: string
      status: "completed"
    } & PptWorkerPreviewResponse)
    & PptWorkerPreviewJobObservability
  | ({
      jobId: string
      status: "failed"
      message: string
    } & PptWorkerPreviewJobObservability)

export type PptWorkerExportRequest = {
  requestId: string
  previewSessionId: string
  selectedVariantKey: string
}

export type PptWorkerExportResponse = {
  fileName: string
  contentType: string
  slideCount: number
  variantName: string
  bufferBase64: string
}
