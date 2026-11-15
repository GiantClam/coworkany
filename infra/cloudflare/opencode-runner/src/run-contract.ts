import type { CloudflareOpenCodeRunRequest, CloudflareSessionRunRequest, OpenCodeProviderConfig } from "../../../../lib/ai-runtime/contracts"
import { isDeprecatedTextModelId } from "@coworkany/runtime-contracts/model-policy"

export type { CloudflareOpenCodeRunRequest }

function isValidOpenCodeProviderConfig(value: unknown): value is OpenCodeProviderConfig {
  if (!value || typeof value !== "object") return false
  const provider = value as Partial<OpenCodeProviderConfig>
  if (typeof provider.providerId !== "string" || !provider.providerId.trim()) return false
  if (typeof provider.modelId !== "string" || !provider.modelId.trim()) return false
  if (isDeprecatedTextModelId(provider.modelId)) return false
  if (typeof provider.baseUrl !== "string" || !provider.baseUrl.trim()) return false
  if (typeof provider.apiKey !== "string" || !provider.apiKey.trim()) return false
  try {
    const url = new URL(provider.baseUrl)
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password
  } catch {
    return false
  }
}

export function parseRunRequest(body: string): CloudflareOpenCodeRunRequest {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    throw new Error("run_request_invalid_json")
  }
  if (!value || typeof value !== "object") throw new Error("run_request_invalid")
  const request = value as Partial<CloudflareOpenCodeRunRequest>
  if (typeof request.runId !== "string" || typeof request.input !== "object" || !request.input || typeof request.timeoutMs !== "number") throw new Error("run_request_invalid")
  if (request.input.runId !== request.runId || request.timeoutMs <= 0 || request.timeoutMs > 20 * 60 * 1000 || !isValidOpenCodeProviderConfig(request.provider)) throw new Error("run_request_provider_required")
  return request as CloudflareOpenCodeRunRequest
}

export function parseSessionRunRequest(body: string): CloudflareSessionRunRequest {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    throw new Error("session_run_request_invalid_json")
  }
  if (!value || typeof value !== "object") throw new Error("session_run_request_invalid")
  const request = value as Partial<CloudflareSessionRunRequest>
  if (
    typeof request.runId !== "string" ||
    typeof request.sessionKey !== "string" ||
    typeof request.input !== "object" ||
    !request.input ||
    request.input.protocolVersion !== 2 ||
    request.input.runId !== request.runId ||
    request.input.sessionKey !== request.sessionKey ||
    request.deadlineMs !== 3_600_000 ||
    !isValidOpenCodeProviderConfig(request.provider) ||
    !/^sess-[0-9a-f]{40}$/.test(request.sessionKey)
  ) {
    throw new Error("session_run_request_invalid")
  }
  if (JSON.stringify(value).length > 96 * 1024) throw new Error("session_run_request_too_large")
  return request as CloudflareSessionRunRequest
}
