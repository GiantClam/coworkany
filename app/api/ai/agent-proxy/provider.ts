import { getAiEntryCurrentProviderConfig } from "@/lib/ai-entry/provider-routing"
import { isDeprecatedTextModelId } from "@coworkany/runtime-contracts/model-policy"

export type ToolChoiceShape = "flat" | "nested"

export type AgentProxyProvider = {
  id: string
  apiKey: string
  baseURL: string
  model: string
  headers?: Record<string, string>
  toolChoiceShape: ToolChoiceShape
  extraBody?: Record<string, unknown>
}

function normalizeEnv(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export function resolveAgentProxyProvider(): AgentProxyProvider | null {
  const dsKey = normalizeEnv(process.env.DEEPSEEK_API_KEY)
  if (dsKey) {
    const thinkingEnabled = normalizeEnv(process.env.DEEPSEEK_THINKING)?.toLowerCase() === "enabled"
    const model = normalizeEnv(process.env.DEEPSEEK_MODEL) || "deepseek-v4-flash"
    if (isDeprecatedTextModelId(model)) return null
    return {
      id: "deepseek",
      apiKey: dsKey,
      baseURL: normalizeEnv(process.env.DEEPSEEK_BASE_URL) || "https://api.deepseek.com",
      model,
      toolChoiceShape: "nested",
      ...(thinkingEnabled ? {} : { extraBody: { thinking: { type: "disabled" } } }),
    }
  }

  const current = getAiEntryCurrentProviderConfig()
  if (!current || !current.apiKey || !current.baseURL) return null
  if (isDeprecatedTextModelId(current.model)) return null
  return { ...current, toolChoiceShape: "flat" }
}

export function normalizeToolChoice(choice: unknown, shape: ToolChoiceShape): unknown {
  if (!choice || typeof choice !== "object") return choice
  const c = choice as { type?: string; name?: unknown; function?: { name?: unknown } }
  if (c.type !== "function") return choice

  if (shape === "flat") {
    if (!c.name && c.function && typeof c.function.name === "string") {
      return { type: "function", name: c.function.name }
    }
    return choice
  }

  if (!c.function && typeof c.name === "string") {
    return { type: "function", function: { name: c.name } }
  }
  return choice
}
