#!/usr/bin/env node

const DEFAULT_MODELS = [
  "claude-opus-6.1",
  "claude-sonnet-6.1",
  "claude-haiku-6.1",
  "gpt-6.1-sol",
  "gpt-6-sol",
  "gpt-6-luna",
  "gemini-3.1-pro-preview",
  "gemini-3-flash-preview",
  "MiniMax-M2.7",
]

function parseArgs(argv) {
  const args = new Map()
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index]
    const value = argv[index + 1]
    if (!key.startsWith("--")) continue
    args.set(key.slice(2), value && !value.startsWith("--") ? value : "true")
    if (value && !value.startsWith("--")) index += 1
  }
  return args
}

async function login(baseUrl, email, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    redirect: "manual",
  })
  if (!response.ok && response.status !== 302) {
    throw new Error(`login_failed_${response.status}`)
  }
  const cookies = response.headers.getSetCookie?.() || []
  const fallbackCookie = response.headers.get("set-cookie")
  return (cookies.length ? cookies : fallbackCookie ? [fallbackCookie] : [])
    .map((item) => item.split(";")[0])
    .join("; ")
}

async function probeModel(baseUrl, cookie, modelId, prompt) {
  const startedAt = Date.now()
  const response = await fetch(`${baseUrl}/api/ai/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: JSON.stringify({
      stream: true,
      message: prompt,
      modelConfig: { providerId: "aiberm", modelId },
      conversationScope: "chat",
    }),
  })
  if (!response.ok || !response.body) {
    const raw = await response.text().catch(() => "")
    throw new Error(`chat_failed_${response.status}:${raw.slice(0, 160)}`)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let firstTokenMs = null
  let totalChars = 0
  let providerModel = null
  let buffer = ""

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split("\n\n")
    buffer = events.pop() || ""
    for (const rawEvent of events) {
      const line = rawEvent.split("\n").find((item) => item.startsWith("data: "))
      if (!line) continue
      const payload = JSON.parse(line.slice(6))
      if (payload.event === "provider_selected" || payload.event === "provider_fallback") {
        providerModel = payload.provider_model || providerModel
      }
      if (payload.event === "message" && typeof payload.answer === "string") {
        if (firstTokenMs === null) firstTokenMs = Date.now() - startedAt
        totalChars += payload.answer.length
      }
      if (payload.event === "message_end") {
        providerModel = payload.provider_model || providerModel
      }
    }
  }

  return {
    modelId,
    providerModel,
    firstTokenMs,
    totalMs: Date.now() - startedAt,
    totalChars,
  }
}

async function main() {
  const args = parseArgs(process.argv)
  const baseUrl = (args.get("base-url") || process.env.AI_ENTRY_PROBE_BASE_URL || "http://localhost:3018").replace(/\/+$/u, "")
  const email = args.get("email") || process.env.AI_ENTRY_PROBE_EMAIL
  const password = args.get("password") || process.env.AI_ENTRY_PROBE_PASSWORD
  const prompt =
    args.get("prompt") ||
    "Use three concrete bullets to explain how AI marketing automation helps B2B companies improve sales efficiency."
  const models = (args.get("models") || process.env.AI_ENTRY_BENCHMARK_MODELS || DEFAULT_MODELS.join(","))
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)

  if (!email || !password) {
    throw new Error("Set AI_ENTRY_PROBE_EMAIL and AI_ENTRY_PROBE_PASSWORD, or pass --email and --password.")
  }

  const cookie = await login(baseUrl, email, password)
  const results = []
  for (const modelId of models) {
    results.push(await probeModel(baseUrl, cookie, modelId, prompt))
  }
  console.table(results)
  console.log(JSON.stringify({ baseUrl, results }, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
