import {
  getPptWorkerBaseUrl,
  getPptWorkerInternalToken,
  getPptWorkerPreviewMaxAttempts,
  getPptWorkerPreviewPollIntervalMs,
  getPptWorkerPreviewRetryDelayMs,
  getPptWorkerPreviewTimeoutMs,
  getPptWorkerRuntimeProfile,
} from "@/lib/lead-tools/config"
import { isPptWorkerTemplateSupported } from "@/lib/lead-tools/ppt-worker-capabilities"
import { isDeprecatedTextModelId } from "@coworkany/runtime-contracts/model-policy"
import type {
  PptWorkerExportRequest,
  PptWorkerModelValue,
  PptWorkerExportResponse,
  PptWorkerPreviewRequest,
  PptWorkerPreviewResponse,
  PptWorkerPreviewStatusResponse,
  PptWorkerPreviewSubmitResponse,
} from "@/lib/lead-tools/ppt-worker-types"

const PPT_WORKER_SUPPORTED_MODELS: PptWorkerModelValue[] = [
  "MiniMax-M2.7-highspeed",
  "MiniMax-M3",
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "gpt-6-astra",
  "gpt-6-luna",
  "gpt-6-sol",
  "gpt-6.1-sol",
  "step-3.7-flash",
]

function normalizeWorkerBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "")
}

function normalizeWorkerModelValue(value: unknown) {
  if (typeof value !== "string") return ""
  return value.trim()
}

function normalizeWorkerRuntimeSlideModel(value: unknown) {
  const normalized = normalizeWorkerModelValue(value)
  return normalized && isDeprecatedTextModelId(normalized) ? "gpt-6.1-sol" : normalized || undefined
}

function isSupportedPptWorkerModel(value: string): value is PptWorkerModelValue {
  return PPT_WORKER_SUPPORTED_MODELS.includes(value as PptWorkerModelValue)
}

export function isSupportedPptWorkerPreviewModel(value: unknown) {
  const normalized = normalizeWorkerModelValue(value)
  return normalized ? isSupportedPptWorkerModel(normalized) : false
}

function resolvePptWorkerFallbackModel() {
  const configuredCandidates = [
    process.env.LEAD_TOOLS_PPT_PREVIEW_MODEL,
    process.env.LEAD_TOOLS_DEEPSEEK_MODEL,
    process.env.LEAD_TOOLS_MINIMAX_MODEL,
    "deepseek-v4-pro",
  ]

  for (const candidate of configuredCandidates) {
    const normalized = normalizeWorkerModelValue(candidate)
    if (isSupportedPptWorkerModel(normalized)) return normalized
  }

  return "deepseek-v4-pro" as const
}

export function normalizePptWorkerPreviewModel(model: unknown) {
  const normalized = normalizeWorkerModelValue(model)
  if (!normalized) return undefined
  if (isSupportedPptWorkerModel(normalized)) return normalized
  return resolvePptWorkerFallbackModel()
}

function buildWorkerHeaders() {
  const token = getPptWorkerInternalToken()

  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildPreviewRequestBody(input: Omit<PptWorkerPreviewRequest, "runtimeProfile">) {
  const templateMode = input.templateMode ?? "auto-4"

  if (
    templateMode === "single-template" &&
    input.templateId &&
    !isPptWorkerTemplateSupported(input.templateId)
  ) {
    throw new Error(`ppt_worker_template_unsupported:${input.templateId}`)
  }

  return {
    ...input,
    templateMode,
    model: normalizePptWorkerPreviewModel(input.model),
    runtimeSlideModel: normalizeWorkerRuntimeSlideModel(input.runtimeSlideModel),
    runtimeProfile: getPptWorkerRuntimeProfile(),
  }
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === "string" && error.trim()) return error.trim()
  return "ppt_worker_preview_failed"
}

function getWorkerPayloadErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback

  const record = payload as {
    message?: unknown
    issues?: unknown
  }
  const issue = Array.isArray(record.issues)
    ? record.issues.find((item) => {
        if (!item || typeof item !== "object") return false
        const path = (item as { path?: unknown }).path
        return Array.isArray(path) && path.includes("templateId")
      })
    : null

  if (issue && typeof issue === "object") {
    const received = (issue as { received?: unknown }).received
    if (typeof received === "string" && received.trim()) {
      return `ppt_worker_template_unsupported:${received.trim()}`
    }
  }

  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim()
  }

  return fallback
}

function shouldRetryPptWorkerPreviewError(message: string) {
  const normalized = message.toLowerCase()

  return (
    normalized.includes("fetch failed") ||
    normalized.includes("network") ||
    normalized.includes("econnreset") ||
    normalized.includes("etimedout") ||
    normalized.includes("und_err_connect_timeout") ||
    normalized.includes("ppt_master_runtime_unavailable") ||
    normalized.includes("ppt_master_repo_missing") ||
    normalized.includes("ppt_master_python_missing") ||
    normalized.includes("ppt_master_script_failed") ||
    normalized.includes("worker_internal_error") ||
    normalized.includes("ppt_worker_http_502") ||
    normalized.includes("ppt_worker_http_503") ||
    normalized.includes("ppt_worker_http_504")
  )
}

async function requestWorker<T>(path: string, options?: { method?: "GET" | "POST"; body?: unknown }): Promise<T> {
  const baseUrl = normalizeWorkerBaseUrl(getPptWorkerBaseUrl())

  if (!baseUrl) {
    throw new Error("ppt_worker_base_url_missing")
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: options?.method || "POST",
    headers: buildWorkerHeaders(),
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
  })

  const payload = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(getWorkerPayloadErrorMessage(payload, `ppt_worker_http_${response.status}`))
  }

  return payload as T
}

async function submitPptWorkerPreviewAndPoll(input: Omit<PptWorkerPreviewRequest, "runtimeProfile">) {
  const submitted = await requestWorker<PptWorkerPreviewSubmitResponse>("/preview", {
    method: "POST",
    body: buildPreviewRequestBody(input),
  })

  const deadline = Date.now() + getPptWorkerPreviewTimeoutMs()
  const pollIntervalMs = getPptWorkerPreviewPollIntervalMs()

  while (Date.now() < deadline) {
    const status = await requestWorker<PptWorkerPreviewStatusResponse>(`/preview-jobs/${submitted.jobId}`, {
      method: "GET",
    })

    if (status.status === "completed") {
      const result: PptWorkerPreviewResponse = {
        previewSessionId: status.previewSessionId,
        generatedAt: status.generatedAt,
        deck: status.deck,
      }
      return result
    }

    if (status.status === "failed") {
      throw new Error(status.message || "ppt_worker_preview_failed")
    }

    await sleep(pollIntervalMs)
  }

  throw new Error("ppt_worker_preview_timeout")
}

export async function requestPptWorkerPreview(
  input: Omit<PptWorkerPreviewRequest, "runtimeProfile">,
) {
  const maxAttempts = getPptWorkerPreviewMaxAttempts()
  const retryDelayMs = getPptWorkerPreviewRetryDelayMs()

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await submitPptWorkerPreviewAndPoll(input)
    } catch (error) {
      const message = getErrorMessage(error)

      if (attempt >= maxAttempts || !shouldRetryPptWorkerPreviewError(message)) {
        throw error
      }

      console.warn("ppt-worker.preview.retry", {
        requestId: input.requestId,
        attempt,
        maxAttempts,
        message,
      })
      await sleep(retryDelayMs)
    }
  }

  throw new Error("ppt_worker_preview_failed")
}

export async function requestPptWorkerPreviewSubmit(
  input: Omit<PptWorkerPreviewRequest, "runtimeProfile">,
) {
  return requestWorker<PptWorkerPreviewSubmitResponse>("/preview", {
    method: "POST",
    body: buildPreviewRequestBody(input),
  })
}

export async function requestPptWorkerPreviewStatus(jobId: string) {
  return requestWorker<PptWorkerPreviewStatusResponse>(`/preview-jobs/${encodeURIComponent(jobId)}`, {
    method: "GET",
  })
}

export async function requestPptWorkerExport(input: PptWorkerExportRequest) {
  return requestWorker<PptWorkerExportResponse>("/export", {
    method: "POST",
    body: input,
  })
}
