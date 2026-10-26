import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile, cp, copyFile, readdir, symlink, rm } from "node:fs/promises"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { join } from "node:path"

import {
  isValidOpenCodeProviderConfig,
  type AgentRuntimeEvent,
  type AgentRuntimeInput,
  type AgentRuntimeInputV2,
  type OpenCodeProviderConfig,
  type RuntimeArtifactPayload,
  type RuntimeProjectSnapshot,
} from "../../../../lib/ai-runtime/contracts.js"
import { buildOpenCodeSystemPrompt, buildOpenCodeUserPrompt } from "../../../../lib/ai-runtime/opencode-prompt.js"
import { OpenCodeServeManager } from "./opencode-serve-manager.js"
import { parseRuntimeProjectSnapshot } from "./project-snapshot.js"
import { displayArtifactName, selectPublishableArtifactRecords } from "./artifact-utils.js"

const port = Number.parseInt(process.env.PORT || "3000", 10) || 3000
const runtimeDir = process.env.OPENCODE_RUNTIME_DIR || "/data/sessions"
const bundleDir = process.env.OPENCODE_RUNTIME_BUNDLE_DIR || "/app/runtime"
const requestTimeoutMs = Number.parseInt(process.env.OPENCODE_RUN_TIMEOUT_MS || "3600000", 10) || 3600000
const internalToken = process.env.OPENCODE_WORKER_INTERNAL_TOKEN?.trim() || ""
const runtimeStateUrl = process.env.OPENCODE_RUNTIME_STATE_URL?.trim().replace(/\/+$/u, "") || ""
const runtimeStateToken = process.env.RUNTIME_STATE_TOKEN?.trim() || process.env.OPENCODE_RUNTIME_STATE_TOKEN?.trim() || ""
const bundleVersion = process.env.OPENCODE_RUNTIME_BUNDLE_VERSION?.trim() || "runtime-bundle-v1"
const residentOpenCode = new OpenCodeServeManager({
  runtimeDir,
  bundleDir,
  bundleVersion: process.env.OPENCODE_RUNTIME_BUNDLE_VERSION?.trim() || "runtime-bundle-v1",
  requestTimeoutMs,
  command: process.env.OPENCODE_BIN || "opencode",
  port: Number.parseInt(process.env.OPENCODE_SERVER_PORT || "4096", 10) || 4096,
  hostname: process.env.OPENCODE_SERVER_HOST?.trim() || "127.0.0.1",
})
const activeRuns = new Map<string, { sessionId: string; abort: () => Promise<boolean> }>()
const runtimeStateWriteChains = new Map<string, Promise<void>>()

type RuntimeRunRecord = {
  runId: string
  status: "running" | "succeeded" | "failed" | "cancelled"
  events: AgentRuntimeEvent[]
  artifacts: RuntimeArtifactPayload[]
  error?: string
  updatedAt: string
}

// Keep completed runs available long enough for the app to recover from a
// Railway edge/SSE disconnect. The child process must not be coupled to the
// lifetime of the HTTP response.
const runRecords = new Map<string, RuntimeRunRecord>()
const runRecordTtlMs = 2 * 60 * 60 * 1000

function getRunRecord(runId: string) {
  const now = Date.now()
  for (const [key, record] of runRecords) {
    if (record.status !== "running" && now - Date.parse(record.updatedAt) > runRecordTtlMs) runRecords.delete(key)
  }
  const existing = runRecords.get(runId)
  if (existing) return existing
  const record: RuntimeRunRecord = { runId, status: "running", events: [], artifacts: [], updatedAt: new Date().toISOString() }
  runRecords.set(runId, record)
  return record
}

type CompatibilityJob = {
  jobId: string
  runId: string
  status: "queued" | "running" | "completed" | "failed"
  updatedAt: string
  result?: {
    previewSessionId: string
    generatedAt: string
    deck: Record<string, unknown>
  }
  pptx?: RuntimeArtifactPayload
  error?: string
}

const compatibilityJobs = new Map<string, CompatibilityJob>()

async function persistRuntimeState(input: { runId: string; event?: AgentRuntimeEvent; status?: "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled" | "timed_out"; error?: string | null }) {
  if (!runtimeStateUrl || !runtimeStateToken) return
  const previous = runtimeStateWriteChains.get(input.runId) || Promise.resolve()
  const next = previous.then(async () => {
    await fetch(runtimeStateUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${runtimeStateToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15_000),
    }).catch((error) => console.warn(JSON.stringify({ event: "opencode_runtime_state_write_failed", runId: input.runId, message: error instanceof Error ? error.message : String(error) })))
  })
  runtimeStateWriteChains.set(input.runId, next)
  await next.finally(() => {
    if (runtimeStateWriteChains.get(input.runId) === next) runtimeStateWriteChains.delete(input.runId)
  })
}

function resolveProviderForRun(provider: OpenCodeProviderConfig): OpenCodeProviderConfig {
  // The authenticated application request is the source of truth. Do not
  // rehydrate credentials from Railway or Vercel environment variables.
  return provider
}

async function fetchExternalRuntimeState(runId: string) {
  if (!runtimeStateUrl || !runtimeStateToken) return null
  const response = await fetch(`${runtimeStateUrl}?runId=${encodeURIComponent(runId)}&after=0`, {
    headers: { Authorization: `Bearer ${runtimeStateToken}`, Accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null)
  if (!response?.ok) return null
  const payload = await response.json().catch(() => null) as { status?: string; events?: Array<{ event?: AgentRuntimeEvent }>; error?: string | null; updatedAt?: string } | null
  if (!payload || (payload.status !== "queued" && payload.status !== "running" && payload.status !== "waiting" && payload.status !== "succeeded" && payload.status !== "failed" && payload.status !== "cancelled")) return null
  return {
    runId,
    status: payload.status === "queued" || payload.status === "waiting" ? "running" : payload.status,
    events: (payload.events || []).map((item) => item.event).filter((event): event is AgentRuntimeEvent => Boolean(event)),
    artifacts: [],
    error: payload.error || undefined,
    updatedAt: payload.updatedAt || new Date().toISOString(),
  } satisfies RuntimeRunRecord
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
  response.end(JSON.stringify(value))
}

function authorized(request: IncomingMessage) {
  if (!internalToken) return true
  return request.headers.authorization === `Bearer ${internalToken}`
}

async function readBody(request: IncomingMessage) {
  const chunks: Uint8Array[] = []
  for await (const chunk of request) chunks.push((Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)) as unknown as Uint8Array)
  return Buffer.concat(chunks as unknown as readonly Uint8Array[]).toString("utf8")
}

function validRunId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)
}

function validSessionKey(value: unknown): value is string {
  return typeof value === "string" && /^(?:sess-[0-9a-f]{40}|ppt-[a-zA-Z0-9_-]{1,120})$/.test(value)
}

function isPersistentPresentationInput(input: AgentRuntimeInput | AgentRuntimeInputV2) {
  return input.agentId === "executive-ppt" || input.agentId === "executive-presentation-ppt" || (input.selectedSkillIds || []).includes("ppt-master") || (input.selectedSkillIds || []).includes("dashiai-ppt")
}

function isPersistentWriterInput(input: AgentRuntimeInput | AgentRuntimeInputV2) {
  return input.agentId === "writer" && typeof input.sessionKey === "string" && /^sess-[0-9a-f]{40}$/u.test(input.sessionKey)
}

function isRailwayPptMasterInput(input: AgentRuntimeInput | AgentRuntimeInputV2) {
  return input.agentId === "executive-ppt" || (input.selectedSkillIds || []).includes("ppt-master")
}

function validateWriterRuntimeInput(input: AgentRuntimeInput | AgentRuntimeInputV2) {
  if (input.writerContext && input.agentId !== "writer") throw new Error("writer_context_agent_mismatch")
  if (input.agentId !== "writer") return
  const selected = [...new Set(input.selectedSkillIds || [])]
  if (input.writerPhase === "briefing") {
    if (selected.length !== 1 || selected[0] !== "writer-briefing" || input.policy.allowNetwork) {
      throw new Error("writer_briefing_contract_invalid")
    }
    return
  }
  if (input.writerPhase !== "draft" || !selected.includes("writer-orchestrator") || !input.policy.allowNetwork) {
    throw new Error("writer_draft_contract_invalid")
  }
}

function safeSkillId(value: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(value)
}

async function readProjectSnapshot(runDir: string): Promise<RuntimeProjectSnapshot | null> {
  const paths = [join(runDir, "project-state.json"), join(runDir, "workspace", "ppt-master", "project-state.json")]
  for (const path of paths) {
    const raw = await readFile(path, "utf8").catch(() => null)
    if (raw === null) continue
    return parseRuntimeProjectSnapshot(raw)
  }
  return null
}

function eventLine(response: ServerResponse, event: AgentRuntimeEvent) {
  response.write(`data: ${JSON.stringify(event)}\n\n`)
}

function mimeType(fileName: string) {
  const ext = fileName.split(".").at(-1)?.toLowerCase() || ""
  return ({
    md: "text/markdown",
    markdown: "text/markdown",
    txt: "text/plain",
    json: "application/json",
    csv: "text/csv",
    html: "text/html",
    pdf: "application/pdf",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    svg: "image/svg+xml",
  } as Record<string, string>)[ext] || "application/octet-stream"
}

function safeArtifactPath(value: unknown) {
  if (typeof value !== "string") return null
  const normalized = value.replaceAll("\\", "/")
  if (!normalized.startsWith("artifacts/") || normalized.includes("../") || normalized.includes("/./")) return null
  const fileName = normalized.slice("artifacts/".length)
  return fileName && !fileName.includes("/") && !fileName.includes("\\") ? fileName : null
}

async function findFiles(root: string, fileName: string, depth = 0): Promise<string[]> {
  if (depth > 6) return []
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const matches: string[] = []
  for (const entry of entries) {
    const fullPath = join(root, entry.name)
    if (entry.isFile() && (entry.name === fileName || (fileName.startsWith(".") && entry.name.endsWith(fileName)))) matches.push(fullPath)
    else if (entry.isDirectory() && !entry.name.startsWith(".")) matches.push(...await findFiles(fullPath, fileName, depth + 1))
    if (matches.length >= 64) break
  }
  return matches
}

async function publishDiscoveredArtifacts(input: AgentRuntimeInput, sessionDir: string, runDir: string) {
  const roots = [join(sessionDir, "workspace"), join(sessionDir, "turns")]
  const pptxSources = roots.map((root) => findFiles(root, ".pptx"))
  const candidates = (await Promise.all([
    ...pptxSources,
    ...roots.map((root) => findFiles(root, ".svg")),
    ...roots.map((root) => findFiles(root, ".png")),
  ])).flat()
  const unique = [...new Set(candidates)]
  const selected = selectPublishableArtifactRecords(
    unique.map((source) => ({ path: source, title: source.split("/").at(-1) || "artifact" })),
    isRailwayPptMasterInput(input),
  ).slice(0, input.artifactContract.maxArtifacts)
  if (!selected.length) return []
  const artifactDir = join(runDir, "artifacts")
  await mkdir(artifactDir, { recursive: true })
  const manifest: Array<Record<string, string>> = []
  for (const record of selected) {
    const source = record.path
    const fileName = displayArtifactName(record.title || source.split("/").at(-1) || "artifact")
    const targetName = `${manifest.length}-${fileName}`
    await copyFile(source, join(artifactDir, targetName)).catch(() => undefined)
    const copied = await readFile(join(artifactDir, targetName)).catch(() => null)
    if (!copied) continue
    manifest.push({ path: `artifacts/${targetName}`, title: fileName, kind: fileName.endsWith(".pptx") ? "pptx" : "preview" })
  }
  if (!manifest.length) return []
  await writeFile(join(runDir, "artifact-manifest.json"), JSON.stringify(manifest), "utf8")
  return manifest
}

async function readArtifacts(input: AgentRuntimeInput, runDir: string, sessionDir = runDir): Promise<RuntimeArtifactPayload[]> {
  const manifestPaths = [...new Set([join(runDir, "artifact-manifest.json"), ...(await findFiles(sessionDir, "artifact-manifest.json"))])]
  const allowed = new Set(input.artifactContract.allowedExtensions.map((item) => item.replace(/^\./u, "").toLowerCase()))
  const candidates: Array<{ record: Record<string, unknown>; fileName: string; bytes: Buffer }> = []
  let totalBytes = 0
  for (const manifestPath of manifestPaths) {
    let manifest: unknown
    try { manifest = JSON.parse(await readFile(manifestPath, "utf8")) } catch { continue }
    if (!Array.isArray(manifest)) continue
    const manifestDir = join(manifestPath, "..")
    for (const item of manifest.slice(0, input.artifactContract.maxArtifacts)) {
      if (!item || typeof item !== "object") continue
      const record = item as Record<string, unknown>
      const fileName = safeArtifactPath(record.path)
      const ext = fileName?.split(".").at(-1)?.toLowerCase() || ""
      if (!fileName || !allowed.has(ext)) continue
      const fullPath = join(manifestDir, fileName)
      const bytes = await readFile(fullPath).catch(() => null)
      if (!bytes || bytes.byteLength > input.artifactContract.maxArtifactBytes) continue
      candidates.push({ record, fileName, bytes })
    }
  }
  const selected = selectPublishableArtifactRecords(
    candidates.map((candidate) => ({
      path: candidate.fileName,
      title: typeof candidate.record.title === "string" ? candidate.record.title : candidate.fileName,
      kind: typeof candidate.record.kind === "string" ? candidate.record.kind : undefined,
    })),
    isRailwayPptMasterInput(input),
  )
  const selectedPaths = new Set(selected.map((record) => record.path))
  const artifacts: RuntimeArtifactPayload[] = []
  for (const candidate of candidates) {
    if (!selectedPaths.has(candidate.fileName) || totalBytes + candidate.bytes.byteLength > input.artifactContract.maxArtifactTotalBytes || artifacts.length >= input.artifactContract.maxArtifacts) continue
    totalBytes += candidate.bytes.byteLength
    const displayTitle = displayArtifactName(typeof candidate.record.title === "string" && candidate.record.title.trim() ? candidate.record.title : candidate.fileName)
    artifacts.push({
      path: `artifacts/${candidate.fileName.slice("artifacts/".length)}`,
      title: displayTitle.slice(0, 255),
      kind: typeof candidate.record.kind === "string" && candidate.record.kind.trim() ? candidate.record.kind.trim().slice(0, 64) : "file",
      mimeType: mimeType(candidate.fileName),
      sizeBytes: candidate.bytes.byteLength,
      contentBase64: candidate.bytes.toString("base64"),
    })
  }
  if (!artifacts.length) {
    const directCandidates = (await Promise.all([...allowed].map((extension) => findFiles(join(runDir, "artifacts"), `.${extension}`)))).flat()
    const directSelected = selectPublishableArtifactRecords(
      [...new Set(directCandidates)].map((fullPath) => ({ path: fullPath, title: fullPath.split("/").at(-1) || "artifact" })),
      isRailwayPptMasterInput(input),
    ).slice(0, input.artifactContract.maxArtifacts)
    for (const record of directSelected) {
      const fullPath = record.path
      const fileName = fullPath.split("/").at(-1) || "artifact"
      const bytes = await readFile(fullPath).catch(() => null)
      if (!bytes || bytes.byteLength > input.artifactContract.maxArtifactBytes || totalBytes + bytes.byteLength > input.artifactContract.maxArtifactTotalBytes) continue
      totalBytes += bytes.byteLength
      artifacts.push({
        path: `artifacts/${fileName}`,
        title: displayArtifactName(fileName),
        kind: fileName.endsWith(".pptx") ? "pptx" : "file",
        mimeType: mimeType(fileName),
        sizeBytes: bytes.byteLength,
        contentBase64: bytes.toString("base64"),
      })
    }
  }
  return artifacts
}

function compatibilityModelHint(provider: OpenCodeProviderConfig) {
  return `${provider.providerId}/${provider.modelId}`
}

function compatibilitySessionKey(requestId: string) {
  const safe = requestId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100)
  return `ppt-${safe || randomUUID().replaceAll("-", "")}`
}

function buildCompatibilityRuntimeInput(request: Record<string, unknown>, runId: string, provider: OpenCodeProviderConfig): AgentRuntimeInput {
  const prompt = typeof request.prompt === "string" ? request.prompt : "生成一份可编辑 PPT"
  const templateId = typeof request.templateId === "string" ? request.templateId : ""
  const pageCount = typeof request.pageCount === "number" && Number.isFinite(request.pageCount)
    ? Math.max(1, Math.min(30, Math.trunc(request.pageCount)))
    : 4
  const requestId = typeof request.requestId === "string" ? request.requestId : runId
  const modelHint = compatibilityModelHint(provider)

  return {
    runId,
    sessionKey: compatibilitySessionKey(requestId),
    conversationId: null,
    enterpriseId: null,
    userId: 0,
    agentId: "executive-ppt",
    selectedSkillIds: ["ppt-master"],
    systemPrompt: "Use the native ppt-master skill to create one editable PowerPoint deck. Complete the SVG quality check and repair loop before finishing.",
    messages: [{
      role: "user",
      content: [
        prompt,
        `Page count: ${pageCount}`,
        templateId ? `Use exactly this template: ${templateId}` : "Choose one best-fit template.",
        "Render exactly one template and one narrative variant.",
      ].join("\n"),
    }],
    attachments: [],
    modelHint,
    artifactContext: [],
    workflowContext: null,
    artifactContract: {
      manifestPath: "artifact-manifest.json",
      artifactDir: "artifacts",
      maxArtifacts: 64,
      maxArtifactBytes: 50 * 1024 * 1024,
      maxArtifactTotalBytes: 200 * 1024 * 1024,
      allowedExtensions: ["pptx", "svg", "png", "html", "json", "md", "txt"],
    },
    policy: {
      allowPlatformTools: false,
      allowTools: false,
      allowMcp: false,
      allowSkillInstall: false,
      allowNetwork: true,
    },
  }
}

function artifactDataUrl(artifact: RuntimeArtifactPayload | undefined) {
  if (!artifact || artifact.mimeType !== "image/svg+xml") return undefined
  return `data:image/svg+xml;base64,${artifact.contentBase64}`
}

function buildCompatibilityDeck(request: Record<string, unknown>, runId: string, artifacts: RuntimeArtifactPayload[], provider: OpenCodeProviderConfig) {
  const pageCount = typeof request.pageCount === "number" && Number.isFinite(request.pageCount)
    ? Math.max(1, Math.min(30, Math.trunc(request.pageCount)))
    : 4
  const templateId = typeof request.templateId === "string" && request.templateId.trim() ? request.templateId.trim() : "ppt-master"
  const prompt = typeof request.prompt === "string" ? request.prompt.trim() : "Editable PPT"
  const svgArtifacts = artifacts.filter((artifact) => artifact.mimeType === "image/svg+xml")
  const slides = Array.from({ length: pageCount }, (_, index) => ({
    id: `opencode-slide-${index + 1}`,
    layout: index === 0 ? "cover" : "insight",
    kicker: "OpenCode + ppt-master",
    title: index === 0 ? prompt.slice(0, 120) : `Slide ${index + 1}`,
    body: "Generated by the native ppt-master skill.",
    bullets: [],
    accent: "#2563eb",
  }))
  const previewAssets = svgArtifacts.map((artifact) => ({
    format: "svg" as const,
    themeId: templateId,
    width: 1600,
    height: 900,
    dataUrl: artifactDataUrl(artifact) || "",
  })).filter((asset) => asset.dataUrl)
  const preview = previewAssets.length ? {
    format: "svg" as const,
    themeId: templateId,
    cover: previewAssets[0],
    slides: previewAssets,
  } : undefined
  const variant = {
    key: `${templateId}-executive-brief`,
    slotLabel: "A" as const,
    styleKey: templateId,
    templateId,
    narrativeAngle: "executive-brief",
    name: "OpenCode ppt-master",
    summary: "Single editable variant rendered by the native ppt-master skill.",
    stylePrompt: "Native ppt-master template",
    palette: { background: "#ffffff", foreground: "#111827", accent: "#2563eb", panel: "#f8fafc", border: "#cbd5e1" },
    strengths: ["editable-pptx", "native-ppt-master", "svg-quality-check"],
    slides,
    ...(preview ? { preview } : {}),
  }
  return {
    title: prompt.slice(0, 120) || "Editable PPT",
    scenario: typeof request.scenario === "string" ? request.scenario : "marketing-campaign",
    language: typeof request.language === "string" ? request.language : "zh-CN",
    generatedAt: new Date().toISOString(),
    outline: slides.map((slide) => slide.title),
    variants: [variant],
    previewEngine: "ppt-master-project",
    previewSessionId: `opencode-${runId}`,
    provider: provider.providerId,
    previewModel: provider.modelId,
    source: "live",
    templateMode: "single-template",
    selectedTemplateId: templateId,
    pageCount,
    resolvedPageCount: pageCount,
  }
}

async function executeCompatibilityJob(job: CompatibilityJob, request: Record<string, unknown>, provider: OpenCodeProviderConfig) {
  job.status = "running"
  job.updatedAt = new Date().toISOString()
  const events: AgentRuntimeEvent[] = []
  const sink = {
    writableEnded: false,
    write(chunk: string) {
      for (const line of String(chunk).split("\n")) {
        if (!line.startsWith("data: ")) continue
        try { events.push(JSON.parse(line.slice(6)) as AgentRuntimeEvent) } catch { /* ignore malformed event */ }
      }
      return true
    },
  } as unknown as ServerResponse
  try {
    const input = buildCompatibilityRuntimeInput(request, job.runId, provider)
    await executeRun(input, sink, provider)
    const artifacts = events.flatMap((event) => event.event === "artifact_payload" ? [event.artifact] : [])
    const pptx = artifacts.find((artifact) => artifact.mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation")
    const failed = events.find((event) => event.event === "runtime_error")
    console.log(JSON.stringify({
      event: "compatibility_run_summary",
      jobId: job.jobId,
      runId: job.runId,
      eventCounts: events.reduce<Record<string, number>>((counts, item) => {
        counts[item.event] = (counts[item.event] || 0) + 1
        return counts
      }, {}),
      textBytes: events.filter((item): item is Extract<AgentRuntimeEvent, { event: "text_delta" }> => item.event === "text_delta")
        .reduce((total, item) => total + Buffer.byteLength(item.delta, "utf8"), 0),
      tools: [...new Set(events.filter((item): item is Extract<AgentRuntimeEvent, { event: "tool_event" }> => item.event === "tool_event").map((item) => item.tool))],
      toolPhases: events.filter((item): item is Extract<AgentRuntimeEvent, { event: "tool_event" }> => item.event === "tool_event")
        .reduce<Record<string, number>>((counts, item) => {
          const key = `${item.tool}:${item.phase}`
          counts[key] = (counts[key] || 0) + 1
          return counts
        }, {}),
      runtimeError: failed?.event === "runtime_error" ? failed.message : null,
      artifactPaths: artifacts.map((artifact) => artifact.path),
    }))
    if (failed) throw new Error(failed.message)
    if (!pptx) throw new Error("ppt_master_artifact_missing:pptx")
    const generatedAt = new Date().toISOString()
    job.pptx = pptx
    job.result = {
      previewSessionId: `opencode-${job.runId}`,
      generatedAt,
      deck: buildCompatibilityDeck(request, job.runId, artifacts, provider),
    }
    job.status = "completed"
  } catch (error) {
    job.status = "failed"
    job.error = error instanceof Error ? error.message : String(error)
  } finally {
    job.updatedAt = new Date().toISOString()
  }
}

function contextHashForInput(input: AgentRuntimeInput | AgentRuntimeInputV2) {
  // This is the legacy-compatible outer envelope. Writer's durable context
  // hash is carried separately and must not change the transport hash.
  const computed = createHash("sha256").update(JSON.stringify({
    revision: input.conversationRevision ?? null,
    messages: input.messages.slice(-20),
    summary: null,
    artifactRefs: input.artifactContext,
  })).digest("hex")
  if (input.contextHash && input.contextHash !== computed) throw new Error("runtime_context_hash_mismatch")
  return computed
}

async function prepareRunDirectory(input: AgentRuntimeInput | AgentRuntimeInputV2) {
  if (!validRunId(input.runId)) throw new Error("runtime_request_invalid")
  const persistentWriter = isPersistentWriterInput(input)
  const sessionDir = persistentWriter
    ? join(runtimeDir, "writer-sessions", input.sessionKey as string)
    : join(runtimeDir, "runs", input.runId)
  const runDir = persistentWriter ? join(sessionDir, "turns", input.runId) : sessionDir
  const workingDir = persistentWriter ? sessionDir : runDir
  await mkdir(runDir, { recursive: true })
  if (input.agentId === "writer") {
    const sharedRuntimeDir = join(runtimeDir, ".runtime")
    await mkdir(sharedRuntimeDir, { recursive: true })
    // OpenCode's resident serve process executes custom tools from the shared
    // runtime cwd. Clear the previous IPC payload before this run owns it.
    await rm(join(sharedRuntimeDir, "writer-submit-result.json"), { force: true })
  }
  await mkdir(join(sessionDir, ".opencode", "skills"), { recursive: true })
  await mkdir(join(sessionDir, ".opencode", "agents"), { recursive: true })
  await mkdir(join(sessionDir, ".opencode", "tools"), { recursive: true })
  await mkdir(join(sessionDir, "workspace"), { recursive: true })
  await mkdir(join(sessionDir, ".runtime"), { recursive: true })
  if (input.agentId === "writer") {
    await writeFile(join(sessionDir, ".runtime", "writer-context.json"), JSON.stringify({
      activeRevision: input.writerContext?.activeDraft?.revision ?? 0,
    }), { encoding: "utf8", mode: 0o600 })
  }
  if (isPersistentPresentationInput(input)) {
    await mkdir(join(sessionDir, "turns", input.runId, "artifacts"), { recursive: true })
  }
  await mkdir(join(sessionDir, "tmp", "home"), { recursive: true })
  // ppt-master's native scripts look for a project-local .venv. Reuse the
  // image-baked dependency environment without persisting the project itself.
  if (isPersistentPresentationInput(input)) {
    await symlink(process.env.PPT_MASTER_VENV_DIR || "/opt/ppt-master-venv", join(sessionDir, "workspace", ".venv"), "dir").catch(() => undefined)
  }
  await mkdir(join(runDir, "artifacts"), { recursive: true })
  await mkdir(join(runDir, "tmp", "home"), { recursive: true })
  // Hydrate the immutable bundle into this run only. Prefer symlinks to the
  // image-baked read-only bundle and fall back to a copy for local tests.
  await rm(join(sessionDir, ".opencode", "skills"), { recursive: true, force: true })
  await rm(join(sessionDir, ".opencode", "agents"), { recursive: true, force: true })
  await rm(join(sessionDir, ".opencode", "tools"), { recursive: true, force: true })
  await mkdir(join(sessionDir, ".opencode"), { recursive: true })
  if (input.agentId === "writer") {
    const bundleSkills = new Set(
      (await readdir(join(bundleDir, "skills"), { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && safeSkillId(entry.name))
        .map((entry) => entry.name),
    )
    const selectedSkillIds = [...new Set(input.selectedSkillIds || [])]
    for (const skillId of selectedSkillIds) {
      if (!safeSkillId(skillId) || !bundleSkills.has(skillId)) throw new Error(`writer_skill_not_in_bundle:${skillId}`)
      const target = join(sessionDir, ".opencode", "skills", skillId)
      await symlink(join(bundleDir, "skills", skillId), target, "dir")
        .catch(() => cp(join(bundleDir, "skills", skillId), target, { recursive: true, force: true }))
    }
  } else {
    await symlink(join(bundleDir, "skills"), join(sessionDir, ".opencode", "skills"), "dir")
      .catch(() => cp(join(bundleDir, "skills"), join(sessionDir, ".opencode", "skills"), { recursive: true, force: true }))
  }
  if (input.agentId === "writer" && input.writerPhase === "draft") {
    const toolSource = join(bundleDir, "tools", "writer_webfetch.ts")
    const toolTarget = join(sessionDir, ".opencode", "tools", "writer_webfetch.ts")
    await mkdir(join(sessionDir, ".opencode", "tools"), { recursive: true })
    await symlink(toolSource, toolTarget, "file")
      .catch(() => cp(toolSource, toolTarget, { force: true }))
    const resultToolSource = join(bundleDir, "tools", "writer_submit_result.ts")
    const resultToolTarget = join(sessionDir, ".opencode", "tools", "writer_submit_result.ts")
    await symlink(resultToolSource, resultToolTarget, "file")
      .catch(() => cp(resultToolSource, resultToolTarget, { force: true }))
  }
  await symlink(join(bundleDir, "agents"), join(sessionDir, ".opencode", "agents"), "dir")
    .catch(() => cp(join(bundleDir, "agents"), join(sessionDir, ".opencode", "agents"), { recursive: true, force: true }))
  await writeFile(join(runDir, "input.json"), JSON.stringify(input), "utf8")
  if (isRailwayPptMasterInput(input) && input.projectSnapshot) {
    await writeFile(join(sessionDir, ".runtime", "project-snapshot.json"), JSON.stringify(input.projectSnapshot), "utf8")
  }
  await writeFile(join(runDir, "system.md"), buildOpenCodeSystemPrompt(input), "utf8")
  await writeFile(join(runDir, "prompt.md"), buildOpenCodeUserPrompt(input, { includeConversationHistory: true }), "utf8")
  return { sessionDir, runDir, workingDir }
}

async function writeOpenCodeSessionConfig(runDir: string, provider: OpenCodeProviderConfig, input: AgentRuntimeInput | AgentRuntimeInputV2) {
  // Transitional local implementation: the provider configuration is scoped
  // to this run directory and deleted in executeRun.finally. The production
  // R1 path replaces apiKey with the Provider Credential Proxy route.
  const configPath = join(runDir, "opencode.json")
  const writerPermissions = input.agentId === "writer" ? {
    "*": "deny",
    read: "allow",
    list: "allow",
    glob: "allow",
    grep: "allow",
    skill: "allow",
    webfetch: "deny",
    websearch: process.env.OPENCODE_ENABLE_EXA === "true" && input.writerPhase === "draft" ? "allow" : "deny",
    writer_webfetch: input.writerPhase === "draft" ? "allow" : "deny",
    writer_submit_result: input.agentId === "writer" && input.writerPhase === "draft" ? "allow" : "deny",
    edit: "deny",
    write: "deny",
    bash: "deny",
    task: "deny",
    question: "deny",
    external_directory: "deny",
  } : "allow"
  await writeFile(configPath, JSON.stringify({
    permission: writerPermissions,
    provider: {
      [provider.providerId]: {
        npm: "@ai-sdk/openai-compatible",
        name: provider.providerId,
        options: { baseURL: provider.baseUrl, apiKey: provider.apiKey },
        models: { [provider.modelId]: { name: provider.modelId } },
      },
    },
  }), { encoding: "utf8", mode: 0o600 })
  return configPath
}

async function writeBundleAttachment(sessionDir: string, input: AgentRuntimeInput | AgentRuntimeInputV2) {
  await writeFile(join(sessionDir, ".opencode", "bundle-attachment.json"), JSON.stringify({
    bundleVersion,
    bundleKey: input.sharedSkillSetSelection?.bundleKey || null,
    agentId: input.agentId || null,
    selectedSkillIds: input.selectedSkillIds || [],
    attachedAt: new Date().toISOString(),
  }), { encoding: "utf8", mode: 0o600 })
}

async function executeRun(
  input: AgentRuntimeInput | AgentRuntimeInputV2,
  response: ServerResponse | null,
  provider: OpenCodeProviderConfig,
  onEvent?: (event: AgentRuntimeEvent) => void,
) {
  if (!isValidOpenCodeProviderConfig(provider)) {
    throw new Error("runtime_request_provider_required")
  }
  const emit = (event: AgentRuntimeEvent) => {
    onEvent?.(event)
    if (response && !response.writableEnded) eventLine(response, event)
    void persistRuntimeState({
      runId: input.runId,
      event,
      status: event.event === "done" ? "succeeded" : event.event === "runtime_error" ? "failed" : "running",
      error: event.event === "runtime_error" ? event.message : undefined,
    })
  }
  let attachedSessionId: string | null = null
  let runDir: string | null = null
  try {
    await persistRuntimeState({ runId: input.runId, status: "running" })
    contextHashForInput(input)
    const resolvedProvider = resolveProviderForRun(provider)
    const prepared = await prepareRunDirectory(input)
    runDir = prepared.runDir
    const { sessionDir, workingDir } = prepared
    validateWriterRuntimeInput(input)
    await writeOpenCodeSessionConfig(workingDir, resolvedProvider, input)
    await writeBundleAttachment(sessionDir, input)
    if (input.agentId === "writer") {
      for (const skillId of input.selectedSkillIds || []) {
        emit({ event: "skill_activated", skillId, runId: input.runId })
      }
    }
    const persistentWriter = isPersistentWriterInput(input)
    attachedSessionId = persistentWriter
      ? await residentOpenCode.createPersistentSession(input, workingDir, resolvedProvider)
      : await residentOpenCode.createTransientSession(input, workingDir, resolvedProvider)
    activeRuns.set(input.runId, { sessionId: attachedSessionId, abort: () => residentOpenCode.abort(attachedSessionId as string) })
    console.log(JSON.stringify({ event: "opencode_serve_session_attached", runId: input.runId, sessionId: attachedSessionId, workingDir, transient: !persistentWriter, persistent: persistentWriter, bundleVersion }))
    const systemPrompt = await readFile(join(runDir, "system.md"), "utf8")
    const userPrompt = await readFile(join(runDir, "prompt.md"), "utf8")
    const completed = await residentOpenCode.prompt(input, attachedSessionId, workingDir, resolvedProvider, systemPrompt, userPrompt, emit)
    if (!completed) return
    const submittedResultPaths = [
      join(workingDir, ".runtime", "writer-submit-result.json"),
      join(runDir, ".runtime", "writer-submit-result.json"),
      join(runtimeDir, ".runtime", "writer-submit-result.json"),
    ]
    let submittedResult: Record<string, unknown> | null = null
    for (const submittedResultPath of submittedResultPaths) {
      const candidate = await readFile(submittedResultPath, "utf8")
        .then((raw) => JSON.parse(raw) as Record<string, unknown>)
        .catch(() => null)
      if (candidate) submittedResult = candidate
      await rm(submittedResultPath, { force: true }).catch(() => undefined)
    }
    if (submittedResult) emit({ event: "writer_result_submitted", result: submittedResult, runId: input.runId })
    console.log(JSON.stringify({ event: "opencode_serve_run_complete", runId: input.runId, sessionId: attachedSessionId, transient: true }))
    const completedRunDir = runDir
    if (!completedRunDir) throw new Error("opencode_run_directory_missing")
    const readPublishableArtifacts = async () => {
      const artifacts = await readArtifacts(input as AgentRuntimeInput, completedRunDir, sessionDir)
      return artifacts
    }
    let discoveredArtifacts = await readPublishableArtifacts()
    if (!discoveredArtifacts.length) {
      await publishDiscoveredArtifacts(input as AgentRuntimeInput, sessionDir, completedRunDir)
      discoveredArtifacts = await readPublishableArtifacts()
    }
    for (const artifact of discoveredArtifacts) emit({ event: "artifact_payload", artifact, runId: input.runId })
    if (isRailwayPptMasterInput(input)) {
      const projectSnapshot = await readProjectSnapshot(completedRunDir)
      if (projectSnapshot) {
        const previousSequence = "checkpoint" in input && input.checkpoint ? input.checkpoint.sequence : 0
        emit({
          event: "checkpoint_saved",
          checkpoint: {
            sequence: previousSequence + 1,
            stage: "turn-complete",
            backupId: null,
            backupDir: null,
            resumePayload: { source: "platform-conversation" },
            projectSnapshot,
          },
          runId: input.runId,
        })
      } else {
        emit({
          event: "runtime_warning",
          code: "ppt_master_project_snapshot_missing",
          message: "The editable PPT project state was not saved; the generated PPTX is still available, but the next turn cannot restore this state.",
          runId: input.runId,
        })
      }
    }
    emit({ event: "done", runId: input.runId })
  } catch (error) {
    emit({ event: "runtime_error", code: "opencode_runtime_failed", message: error instanceof Error ? error.message.slice(0, 1024) : "OpenCode runtime failed.", retryable: true, runId: input.runId })
  } finally {
    activeRuns.delete(input.runId)
    if (attachedSessionId && runDir && !isPersistentWriterInput(input)) await residentOpenCode.disposeTransientSession(attachedSessionId, runDir)
    if (runDir) await rm(runDir, { recursive: true, force: true }).catch(() => undefined)
  }
}

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") return json(response, 200, { ok: true, service: "opencode-runtime", runtime: "railway", opencodeServe: residentOpenCode.isReady() })
  if (!authorized(request)) return json(response, 401, { error: "unauthorized" })
  if (request.method === "POST" && request.url === "/sessions/prepare") {
    try {
      const payload = JSON.parse(await readBody(request)) as { runId?: unknown; sessionKey?: unknown; input?: AgentRuntimeInput | AgentRuntimeInputV2; provider?: OpenCodeProviderConfig }
      if (!payload.input || !isValidOpenCodeProviderConfig(payload.provider) || typeof payload.sessionKey !== "string" || !validSessionKey(payload.sessionKey)) {
        throw new Error("runtime_session_prepare_invalid")
      }
      if (!validRunId(payload.runId) || payload.input.runId !== payload.runId || payload.input.sessionKey !== payload.sessionKey) {
        throw new Error("runtime_session_prepare_key_mismatch")
      }
      await residentOpenCode.start()
      await readdir(bundleDir)
      return json(response, 200, {
        prepared: true,
        sessionReady: true,
        sessionKey: payload.sessionKey,
        bundleVersion,
        contextHash: contextHashForInput(payload.input),
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      })
    } catch (error) {
      return json(response, 400, { error: error instanceof Error ? error.message : "runtime_session_prepare_failed" })
    }
  }
  if (request.method === "POST" && request.url === "/preview") {
    try {
      const payload = JSON.parse(await readBody(request)) as Record<string, unknown> & { provider?: unknown }
      if (!isValidOpenCodeProviderConfig(payload.provider)) throw new Error("runtime_request_provider_required")
      const jobId = randomUUID()
      const job: CompatibilityJob = { jobId, runId: randomUUID(), status: "queued", updatedAt: new Date().toISOString() }
      compatibilityJobs.set(jobId, job)
      void executeCompatibilityJob(job, payload, payload.provider).catch((error) => {
        job.status = "failed"
        job.error = error instanceof Error ? error.message : String(error)
        job.updatedAt = new Date().toISOString()
      })
      return json(response, 200, { jobId, status: "queued" })
    } catch (error) {
      return json(response, 400, { error: error instanceof Error ? error.message : "preview_request_invalid" })
    }
  }
  const previewJobMatch = request.method === "GET" && request.url?.match(/^\/preview-jobs\/([^/?]+)$/)
  if (previewJobMatch) {
    const job = compatibilityJobs.get(decodeURIComponent(previewJobMatch[1]))
    if (!job) return json(response, 404, { error: "preview_job_not_found" })
    if (job.status === "failed") return json(response, 200, { jobId: job.jobId, status: "failed", message: job.error || "ppt_worker_preview_failed", updatedAt: job.updatedAt })
    if (job.status !== "completed" || !job.result) return json(response, 200, { jobId: job.jobId, status: job.status, updatedAt: job.updatedAt })
    return json(response, 200, { jobId: job.jobId, status: "completed", ...job.result, updatedAt: job.updatedAt })
  }
  if (request.method === "POST" && request.url === "/export") {
    try {
      const payload = JSON.parse(await readBody(request)) as { previewSessionId?: string }
      const job = [...compatibilityJobs.values()].find((item) => item.result?.previewSessionId === payload.previewSessionId)
      if (!job?.pptx) return json(response, 404, { error: "preview_session_not_found" })
      return json(response, 200, {
        fileName: job.pptx.title || "editable-ppt.pptx",
        contentType: job.pptx.mimeType,
        slideCount: job.result?.deck && typeof job.result.deck.pageCount === "number" ? job.result.deck.pageCount : 0,
        variantName: "OpenCode ppt-master",
        bufferBase64: job.pptx.contentBase64,
      })
    } catch (error) {
      return json(response, 400, { error: error instanceof Error ? error.message : "export_request_invalid" })
    }
  }
  if (request.method === "POST" && (request.url === "/v1/sessions/execute" || request.url === "/runs")) {
    let requestRunId: string | null = null
    try {
      const payload = JSON.parse(await readBody(request)) as { input?: AgentRuntimeInput | AgentRuntimeInputV2; provider?: OpenCodeProviderConfig }
      if (!payload.input) throw new Error("runtime_request_invalid")
      if (!isValidOpenCodeProviderConfig(payload.provider)) throw new Error("runtime_request_provider_required")
      const externalProvider = payload.provider
      requestRunId = payload.input.runId
      const existingRun = runRecords.get(payload.input.runId) || await fetchExternalRuntimeState(payload.input.runId)
      if (existingRun?.status === "running") return json(response, 409, { error: "run_already_running", runId: payload.input.runId })
      // Railway can terminate a long response even while the Node process and
      // OpenCode child remain healthy. For client requests that explicitly
      // opt in, detach execution from this SSE response and expose the
      // persisted run record for recovery polling instead.
      if (request.headers.prefer?.includes("respond-async")) {
        const existing = runRecords.get(payload.input.runId)
        if (existing) return json(response, 202, { runId: existing.runId, status: existing.status })
        const record = getRunRecord(payload.input.runId)
        record.status = "running"
        record.error = undefined
        record.updatedAt = new Date().toISOString()
        void (async () => {
          try {
            await executeRun(payload.input!, null, externalProvider, (event) => {
              record.events.push(event)
              if (event.event === "artifact_payload") record.artifacts.push(event.artifact)
              if (event.event === "runtime_error") {
                record.status = "failed"
                record.error = event.message
              } else if (event.event === "done") {
                record.status = "succeeded"
              }
              record.updatedAt = new Date().toISOString()
            })
            if (record.status === "running") record.status = "succeeded"
          } catch (error) {
            record.status = "failed"
            record.error = error instanceof Error ? error.message : "runtime_execution_failed"
          } finally {
            record.updatedAt = new Date().toISOString()
          }
        })()
        return json(response, 202, { runId: record.runId, status: record.status })
      }
      const record = getRunRecord(payload.input.runId)
      if (record.status === "succeeded") {
        response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive" })
        for (const event of record.events) eventLine(response, event)
        response.end()
        return
      }
      record.status = "running"
      record.error = undefined
      record.updatedAt = new Date().toISOString()
      response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive" })
      // Flush the SSE response immediately and keep long model/tool turns
      // alive while OpenCode is silent before its first event. Railway's edge
      // otherwise terminates an idle stream before the 60-minute run timeout.
      response.write(": ready\n\n")
      const heartbeat = setInterval(() => {
        if (!response.writableEnded) {
          const event: AgentRuntimeEvent = {
            event: "runtime_warning",
            code: "runtime_heartbeat",
            message: "OpenCode run is still active.",
            runId: payload.input?.runId || "unknown",
          }
          record.events.push(event)
          record.updatedAt = new Date().toISOString()
          eventLine(response, event)
        }
      }, 15_000)
      try {
        await executeRun(payload.input, response, externalProvider, (event) => {
          record.events.push(event)
          if (event.event === "artifact_payload") record.artifacts.push(event.artifact)
          if (event.event === "runtime_error") {
            record.status = "failed"
            record.error = event.message
          } else if (event.event === "done") {
            record.status = "succeeded"
          }
          record.updatedAt = new Date().toISOString()
        })
        if (record.status === "running") record.status = "succeeded"
      } finally {
        clearInterval(heartbeat)
        record.updatedAt = new Date().toISOString()
      }
    } catch (error) {
      const record = requestRunId ? getRunRecord(requestRunId) : null
      if (record) {
        record.status = "failed"
        record.error = error instanceof Error ? error.message : "runtime_execution_failed"
        record.updatedAt = new Date().toISOString()
      }
      if (!response.headersSent) return json(response, 400, { error: error instanceof Error ? error.message : "runtime_execution_failed" })
      if (!response.writableEnded) eventLine(response, { event: "runtime_error", code: "runtime_execution_failed", message: error instanceof Error ? error.message.slice(0, 1024) : "runtime_execution_failed", retryable: true, runId: "unknown" })
    } finally {
      if (!response.writableEnded) response.end()
    }
    return
  }
  const runStatusMatch = request.method === "GET" && request.url?.match(/^\/runs\/([0-9a-f-]{36})$/i)
  if (runStatusMatch) {
    const record = runRecords.get(runStatusMatch[1]) || await fetchExternalRuntimeState(runStatusMatch[1])
    if (!record) return json(response, 404, { error: "run_not_found" })
    return json(response, 200, {
      runId: record.runId,
      status: record.status,
      events: record.events,
      artifacts: record.artifacts,
      error: record.error || null,
      updatedAt: record.updatedAt,
    })
  }
  const cancelMatch = request.method === "POST" && request.url?.match(/^(?:\/v1)?\/runs\/([0-9a-f-]{36})\/cancel$/i)
  if (cancelMatch) {
    const active = activeRuns.get(cancelMatch[1])
    if (active) await active.abort().catch(() => false)
    const record = runRecords.get(cancelMatch[1])
    if (record) {
      record.status = "cancelled"
      record.updatedAt = new Date().toISOString()
    }
    await persistRuntimeState({ runId: cancelMatch[1], status: "cancelled" })
    return json(response, 200, { ok: true, runId: cancelMatch[1] })
  }
  return json(response, 404, { error: "not_found" })
})

const shutdown = () => {
  void residentOpenCode.stop()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on("SIGTERM", shutdown)
process.on("SIGINT", shutdown)

void mkdir(runtimeDir, { recursive: true }).then(async () => {
  try {
    await residentOpenCode.start()
  } catch (error) {
    console.error(JSON.stringify({ event: "opencode_serve_start_failed", message: error instanceof Error ? error.message : String(error) }))
  }
  server.listen(port, "0.0.0.0", () => console.log(JSON.stringify({ event: "opencode_runtime_listening", port, runtimeDir, residentOpenCode: residentOpenCode.isReady() })))
})
