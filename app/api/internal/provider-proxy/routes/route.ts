import { NextRequest, NextResponse } from "next/server"

import { getConfiguredAiEntryProviderForModel } from "@/lib/ai-entry/provider-routing"
import { createProviderRouteToken } from "@/lib/ai-runtime/provider-proxy"
import { getEnterpriseTextRuntimeProviderConfigForProxy } from "@/lib/platform/enterprise-runtime-config"
import { isDeprecatedTextModelId } from "@coworkany/runtime-contracts/model-policy"

function authorized(request: NextRequest) {
  const expected = process.env.RUNTIME_PROXY_TOKEN?.trim() || ""
  return Boolean(expected) && request.headers.get("authorization") === `Bearer ${expected}`
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ error: "provider_proxy_unauthorized" }, { status: 401 })
  let payload: { providerId?: unknown; modelId?: unknown; runId?: unknown; enterpriseId?: unknown }
  try { payload = await request.json() as typeof payload } catch { return NextResponse.json({ error: "provider_proxy_invalid_json" }, { status: 400 }) }
  const providerId = typeof payload.providerId === "string" ? payload.providerId.trim() : ""
  const modelId = typeof payload.modelId === "string" ? payload.modelId.trim() : ""
  const runId = typeof payload.runId === "string" ? payload.runId.trim() : ""
  const enterpriseId = payload.enterpriseId === null ? null : typeof payload.enterpriseId === "number" && Number.isInteger(payload.enterpriseId) ? payload.enterpriseId : null
  if (!providerId || !modelId || !/^[0-9a-f-]{36}$/iu.test(runId)) return NextResponse.json({ error: "provider_proxy_route_invalid" }, { status: 400 })
  if (isDeprecatedTextModelId(modelId)) return NextResponse.json({ error: "provider_proxy_deprecated_model" }, { status: 400 })
  const provider =
    getConfiguredAiEntryProviderForModel(providerId, modelId) ||
    (providerId === "pptoken" || enterpriseId === null
      ? null
      : await getEnterpriseTextRuntimeProviderConfigForProxy({ enterpriseId, providerId }))
  if (!provider) return NextResponse.json({ error: "provider_proxy_provider_unavailable" }, { status: 404 })
  const publicUrl = process.env.OPENCODE_PROVIDER_PROXY_PUBLIC_URL?.trim().replace(/\/+$/u, "") || ""
  if (!publicUrl) return NextResponse.json({ error: "provider_proxy_public_url_missing" }, { status: 503 })
  const secret = process.env.RUNTIME_PROXY_TOKEN?.trim() || ""
  // Long-running OpenCode jobs (especially editable PPT generation) can spend
  // several minutes in tool calls before the next provider request. Keep the
  // scoped credential valid for the full runtime window instead of expiring
  // during an otherwise healthy run.
  const routeToken = createProviderRouteToken({ secret, providerId, modelId, runId, enterpriseId, ttlMs: 60 * 60 * 1000 })
  return NextResponse.json({
    providerId: provider.id,
    modelId,
    baseUrl: `${publicUrl}/${encodeURIComponent(provider.id)}`,
    apiKey: routeToken,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  }, { headers: { "cache-control": "no-store" } })
}
