import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import type { AiEntryProviderConfig } from "./provider-routing"
import { isDeprecatedTextModelId } from "@coworkany/runtime-contracts/model-policy"

type DesktopProviderProfile = {
  id?: unknown
  source?: unknown
  baseUrl?: unknown
  model?: unknown
  models?: unknown
  apiKey?: unknown
}

type DesktopConfig = {
  provider?: DesktopProviderProfile
  providers?: Record<string, DesktopProviderProfile>
  defaults?: { text?: unknown }
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function configCandidates() {
  const explicit = text(process.env.AIMARKETING_DESKTOP_CONFIG_PATH || process.env.AIMARKETING_CONFIG_PATH)
  const localAppData = text(process.env.LOCALAPPDATA)
  return [
    explicit,
    localAppData ? join(localAppData, "AIMarketing", "config.json") : "",
  ].filter(Boolean)
}

function readDesktopConfig(): DesktopConfig | null {
  for (const path of configCandidates()) {
    if (!existsSync(path)) continue
    try {
      const value = JSON.parse(readFileSync(path, "utf8")) as DesktopConfig
      if (value && typeof value === "object") return value
    } catch {
      // The desktop runtime owns config validation. The web/server fallback
      // treats an unreadable local file as unavailable and keeps its normal
      // provider path intact.
    }
  }
  return null
}

function resolveProfile(config: DesktopConfig) {
  const defaultId = text(config.defaults?.text)
  return (defaultId && config.providers?.[defaultId]) || config.provider || null
}

/**
 * Resolve the same text provider selected by the desktop config.json. The
 * result uses a stable adapter id because config.json profile ids are user
 * controlled (for example, `text-main`) and are not AI Entry provider ids.
 */
export function resolveDesktopConfiguredWriterProvider(): AiEntryProviderConfig | null {
  const config = readDesktopConfig()
  if (!config) return null

  const profile = resolveProfile(config)
  if (!profile) return null

  const models = Array.isArray(profile.models) ? profile.models.map(text).filter(Boolean) : []
  const configuredModel = text(profile.model)
  const model = configuredModel && !isDeprecatedTextModelId(configuredModel)
    ? configuredModel
    : models.find((candidate) => !isDeprecatedTextModelId(candidate))
  const baseURL = text(profile.baseUrl)
  const apiKey = text(profile.apiKey)
  if (!model || !baseURL || isDeprecatedTextModelId(model)) return null

  return {
    id: "desktop-configured",
    apiKey: apiKey || "desktop-configured",
    baseURL,
    model,
  }
}
