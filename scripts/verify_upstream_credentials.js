const fs = require("fs")
const path = require("path")
const https = require("https")

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return

  const source = fs.readFileSync(filePath, "utf8")
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue

    const separatorIndex = line.indexOf("=")
    if (separatorIndex <= 0) continue

    const key = line.slice(0, separatorIndex).trim()
    if (!key || process.env[key]) continue

    let value = line.slice(separatorIndex + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    process.env[key] = value
  }
}

function request(method, url, headers = {}, payload) {
  return new Promise((resolve) => {
    const target = new URL(url)
    const bodyText = payload ? JSON.stringify(payload) : ""
    const req = https.request(
      {
        method,
        hostname: target.hostname,
        port: target.port || undefined,
        path: `${target.pathname}${target.search}`,
        headers: {
          ...headers,
          ...(bodyText
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(bodyText),
              }
            : {}),
        },
      },
      (res) => {
        let responseText = ""
        res.on("data", (chunk) => {
          responseText += chunk.toString("utf8")
        })
        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            body: responseText.slice(0, 500),
          })
        })
      },
    )

    req.on("error", (error) => {
      resolve({
        status: 0,
        body: error instanceof Error ? error.message : String(error),
      })
    })

    if (bodyText) {
      req.write(bodyText)
    }
    req.end()
  })
}

function summarizeResult(name, result) {
  return {
    name,
    status: result.status,
    ok: result.status >= 200 && result.status < 300,
    unauthorized: result.status === 401,
    bodyPreview: result.body,
  }
}

async function verifyOpenAiCompatibleProvider(input) {
  const apiKey = input.apiKey || ""
  const baseUrl = (input.baseUrl || "").replace(/\/$/, "")
  const model = input.model || "gpt-6.1-sol"

  if (!apiKey) {
    return {
      name: input.name,
      status: -1,
      ok: false,
      unauthorized: false,
      bodyPreview: `${input.envKeyName} is missing`,
    }
  }

  const result = await request(
    "POST",
    `${baseUrl}/chat/completions`,
    {
      Authorization: `Bearer ${apiKey}`,
    },
    {
      model,
      messages: [{ role: "user", content: "Reply with OK only." }],
      max_tokens: 16,
    },
  )

  return summarizeResult(input.name, result)
}

async function verifyAiberm() {
  return verifyOpenAiCompatibleProvider({
    name: "aiberm.text",
    envKeyName: "AIBERM_API_KEY",
    apiKey: process.env.AIBERM_API_KEY || process.env.WRITER_AIBERM_API_KEY || "",
    baseUrl: process.env.AIBERM_BASE_URL || "https://aiberm.com/v1",
    model: process.env.WRITER_TEXT_MODEL || process.env.AI_ENTRY_AIBERM_MODEL || "claude-sonnet-5.1",
  })
}

async function verifyCrazyroute() {
  return verifyOpenAiCompatibleProvider({
    name: "crazyroute.text",
    envKeyName: "CRAZYROUTE_API_KEY",
    apiKey:
      process.env.CRAZYROUTE_API_KEY ||
      process.env.CRAZYROUTER_API_KEY ||
      process.env.AI_ENTRY_CRAZYROUTE_API_KEY ||
      "",
    baseUrl:
      process.env.CRAZYROUTE_BASE_URL ||
      process.env.CRAZYROUTER_BASE_URL ||
      process.env.AI_ENTRY_CRAZYROUTE_BASE_URL ||
      "https://crazyrouter.com/v1",
    model: process.env.AI_ENTRY_CRAZYROUTE_MODEL || "gpt-6.1-sol",
  })
}

async function verifyDify() {
  const baseUrl = (process.env.DIFY_DEFAULT_BASE_URL || "").replace(/\/$/, "")
  const brandApiKey = process.env.DIFY_DEFAULT_BRAND_API_KEY || ""
  const growthApiKey = process.env.DIFY_DEFAULT_GROWTH_API_KEY || ""

  if (!baseUrl) {
    return [
      {
        name: "dify.brand.conversations",
        status: -1,
        ok: false,
        unauthorized: false,
        bodyPreview: "DIFY_DEFAULT_BASE_URL is missing",
      },
      {
        name: "dify.growth.conversations",
        status: -1,
        ok: false,
        unauthorized: false,
        bodyPreview: "DIFY_DEFAULT_BASE_URL is missing",
      },
    ]
  }

  const checks = []

  if (!brandApiKey) {
    checks.push({
      name: "dify.brand.conversations",
      status: -1,
      ok: false,
      unauthorized: false,
      bodyPreview: "DIFY_DEFAULT_BRAND_API_KEY is missing",
    })
  } else {
    const brandResult = await request(
      "GET",
      `${baseUrl}/conversations?user=demo@example.com_brand-strategy&limit=1`,
      {
        Authorization: `Bearer ${brandApiKey}`,
      },
    )
    checks.push(summarizeResult("dify.brand.conversations", brandResult))
  }

  if (!growthApiKey) {
    checks.push({
      name: "dify.growth.conversations",
      status: -1,
      ok: false,
      unauthorized: false,
      bodyPreview: "DIFY_DEFAULT_GROWTH_API_KEY is missing",
    })
  } else {
    const growthResult = await request(
      "GET",
      `${baseUrl}/conversations?user=demo@example.com_growth&limit=1`,
      {
        Authorization: `Bearer ${growthApiKey}`,
      },
    )
    checks.push(summarizeResult("dify.growth.conversations", growthResult))
  }

  return checks
}

async function run() {
  loadDotEnv(path.resolve(process.cwd(), ".env"))

  const [aibermCheck, crazyrouteCheck, difyChecks] = await Promise.all([
    verifyAiberm(),
    verifyCrazyroute(),
    verifyDify(),
  ])
  const results = [aibermCheck, crazyrouteCheck, ...difyChecks]

  const hasUnauthorized = results.some((item) => item.unauthorized)
  const hasFailure = results.some((item) => !item.ok)

  console.log(JSON.stringify({ results }, null, 2))

  if (hasUnauthorized) {
    console.error("verify.upstream_credentials.failed: unauthorized_401_detected")
    process.exitCode = 1
    return
  }

  if (hasFailure) {
    console.error("verify.upstream_credentials.failed: non_success_status_detected")
    process.exitCode = 1
    return
  }

  console.log("verify.upstream_credentials.passed")
}

run().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  )
  process.exitCode = 1
})
