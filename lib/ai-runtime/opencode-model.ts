import { isDeprecatedTextModelId } from "@coworkany/runtime-contracts/model-policy"

function normalize(value: string | null | undefined) {
  return typeof value === "string" ? value.trim() : ""
}

function normalizeOpenCodeProviderKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

/**
 * The SaaS model catalog exposes provider-local display IDs, while OpenCode
 * resolves models using provider/model IDs. Keep the conversion at the
 * runtime boundary so native-provider requests keep their existing IDs.
 */
export function resolveOpenCodeModelHint(input: {
  providerId?: string | null
  modelId?: string | null
}) {
  const modelId = normalize(input.modelId)
  if (!modelId) return null
  if (isDeprecatedTextModelId(modelId)) throw new Error("deprecated_text_model_unavailable")

  const providerId = normalize(input.providerId).toLowerCase()
  const providerKey = providerId ? normalizeOpenCodeProviderKey(providerId) : ""
  // OpenCode config keys normalize platform provider IDs (for example
  // enterprise-openai-compatible -> enterprise_openai_compatible). Keep the
  // selected provider attached to the model so external-compatible routes do
  // not accidentally resolve through a native provider with the same model.
  if (providerKey && modelId.startsWith(`${providerKey}/`)) return modelId
  if (providerId && modelId.startsWith(`${providerId}/`)) {
    return providerKey ? `${providerKey}/${modelId.slice(providerId.length + 1)}` : modelId
  }

  if (providerId === "openrouter") {
    return `openrouter/${modelId === "grok-4.5" ? "x-ai/grok-4.5" : modelId}`
  }

  if (providerKey) return `${providerKey}/${modelId}`

  return modelId
}
