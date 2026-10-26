import { NextRequest, NextResponse } from "next/server"

import { getConfiguredAiEntryProviderForModel } from "@/lib/ai-entry/provider-routing"
import { verifyProviderRouteToken } from "@/lib/ai-runtime/provider-proxy"
import { getEnterpriseTextRuntimeProviderConfigForProxy } from "@/lib/platform/enterprise-runtime-config"
import { isDeprecatedTextModelId } from "@coworkany/runtime-contracts/model-policy"

function routeToken(request: NextRequest) {
  const value = request.headers.get("authorization") || ""
  return value.startsWith("Bearer ") ? value.slice("Bearer ".length).trim() : ""
}

function upstreamUrl(baseUrl: string, path: string[], search: string) {
  const base = baseUrl.replace(/\/+$/u, "")
  const suffix = path.map((segment) => encodeURIComponent(segment)).join("/")
  return `${base}/${suffix}${search}`
}

async function proxy(request: NextRequest, context: { params: Promise<{ providerId: string; path?: string[] }> }) {
  const secret = process.env.RUNTIME_PROXY_TOKEN?.trim() || ""
  const { providerId, path = [] } = await context.params
  const claims = verifyProviderRouteToken(routeToken(request), secret)
  if (!claims || claims.providerId !== providerId) return NextResponse.json({ error: "provider_proxy_route_invalid" }, { status: 401 })
  if (isDeprecatedTextModelId(claims.modelId)) return NextResponse.json({ error: "provider_proxy_deprecated_model" }, { status: 403 })
  const provider =
    getConfiguredAiEntryProviderForModel(providerId, claims.modelId) ||
    (providerId === "pptoken" || claims.enterpriseId === null
      ? null
      : await getEnterpriseTextRuntimeProviderConfigForProxy({ enterpriseId: claims.enterpriseId, providerId }))
  if (!provider) return NextResponse.json({ error: "provider_proxy_provider_unavailable" }, { status: 404 })
  const upstream = new URL(provider.baseURL)
  console.info("provider_proxy.upstream.start", {
    providerId,
    modelId: claims.modelId,
    upstreamHost: upstream.host,
    upstreamPath: upstream.pathname,
  })
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer()
  if (body && body.byteLength > 16 * 1024 * 1024) return NextResponse.json({ error: "provider_proxy_body_too_large" }, { status: 413 })
  if (body && body.byteLength) {
    try {
      const parsed = JSON.parse(new TextDecoder().decode(body)) as { model?: unknown }
      if (typeof parsed.model === "string" && parsed.model !== claims.modelId) return NextResponse.json({ error: "provider_proxy_model_mismatch" }, { status: 403 })
    } catch {
      // Non-JSON provider requests are forwarded unchanged.
    }
  }
  const headers = new Headers()
  const contentType = request.headers.get("content-type")
  if (contentType) headers.set("content-type", contentType)
  headers.set("authorization", `Bearer ${provider.apiKey}`)
  headers.set("accept", request.headers.get("accept") || "application/json")
  const response = await fetch(upstreamUrl(provider.baseURL, path, request.nextUrl.search), {
    method: request.method,
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
  }).catch((error) => NextResponse.json({ error: "provider_proxy_upstream_failed", message: error instanceof Error ? error.message : String(error) }, { status: 502 }))
  if (response instanceof NextResponse) return response
  console.info("provider_proxy.upstream.result", {
    providerId,
    modelId: claims.modelId,
    status: response.status,
    contentType: response.headers.get("content-type") || "",
  })
  const outputHeaders = new Headers()
  for (const key of ["content-type", "cache-control", "retry-after"]) {
    const value = response.headers.get(key)
    if (value) outputHeaders.set(key, value)
  }
  return new NextResponse(response.body, { status: response.status, headers: outputHeaders })
}

export const GET = proxy
export const POST = proxy
export const PUT = proxy
export const PATCH = proxy
export const DELETE = proxy
