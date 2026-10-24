import assert from "node:assert/strict"
import test from "node:test"

import type { PptWorkerPreviewRequest } from "./ppt-worker-types"
import {
  normalizePptWorkerPreviewModel,
  requestPptWorkerExport,
  requestPptWorkerPreview,
  requestPptWorkerPreviewSubmit,
} from "./ppt-worker-client"

test("ppt worker transport types are importable", () => {
  const request: PptWorkerPreviewRequest = {
    requestId: "req_1",
    prompt: "Build a sales deck for AI consulting",
    scenario: "sales-deck",
    language: "zh-CN",
    templateMode: "auto-4",
    allowMockFallback: false,
    runtimeProfile: "railway-linux",
  }

  assert.equal(request.runtimeProfile, "railway-linux")
})

test("ppt worker normalizes unsupported OpenAI model aliases before transport", () => {
  const previousPreviewModel = process.env.LEAD_TOOLS_PPT_PREVIEW_MODEL
  const previousDeepSeekModel = process.env.LEAD_TOOLS_DEEPSEEK_MODEL
  const previousMiniMaxModel = process.env.LEAD_TOOLS_MINIMAX_MODEL

  try {
    delete process.env.LEAD_TOOLS_PPT_PREVIEW_MODEL
    delete process.env.LEAD_TOOLS_DEEPSEEK_MODEL
    delete process.env.LEAD_TOOLS_MINIMAX_MODEL

    assert.equal(normalizePptWorkerPreviewModel("openai/gpt-5.4-mini"), "deepseek-v4-pro")
  } finally {
    if (previousPreviewModel === undefined) {
      delete process.env.LEAD_TOOLS_PPT_PREVIEW_MODEL
    } else {
      process.env.LEAD_TOOLS_PPT_PREVIEW_MODEL = previousPreviewModel
    }

    if (previousDeepSeekModel === undefined) {
      delete process.env.LEAD_TOOLS_DEEPSEEK_MODEL
    } else {
      process.env.LEAD_TOOLS_DEEPSEEK_MODEL = previousDeepSeekModel
    }

    if (previousMiniMaxModel === undefined) {
      delete process.env.LEAD_TOOLS_MINIMAX_MODEL
    } else {
      process.env.LEAD_TOOLS_MINIMAX_MODEL = previousMiniMaxModel
    }
  }
})

test("ppt worker preview posts runtime profile, fallback mode, and auth token", async () => {
  const originalFetch = global.fetch
  const previousBaseUrl = process.env.PPT_WORKER_BASE_URL
  const previousToken = process.env.PPT_WORKER_INTERNAL_TOKEN
  const previousProfile = process.env.PPT_WORKER_RUNTIME_PROFILE
  const previousPollInterval = process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS
  const previousTimeout = process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS

  try {
    process.env.PPT_WORKER_BASE_URL = "https://ppt-worker.example.com/"
    process.env.PPT_WORKER_INTERNAL_TOKEN = "secret-token"
    process.env.PPT_WORKER_RUNTIME_PROFILE = "railway-linux"
    process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS = "1"
    process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS = "1000"

    const seen: Array<{ url?: string; body?: string; auth?: string; method?: string }> = []
    global.fetch = (async (input, init) => {
      const headers = init?.headers as Record<string, string> | undefined
      seen.push({
        url: String(input),
        body: String(init?.body || ""),
        auth: headers?.authorization ?? "",
        method: String(init?.method || "GET"),
      })

      if (String(input).endsWith("/preview")) {
        return {
          ok: true,
          status: 202,
          json: async () => ({
            jobId: "job_1",
            status: "queued",
          }),
        } as Response
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          jobId: "job_1",
          status: "completed",
          previewSessionId: "session_1",
          generatedAt: "2026-06-24T00:00:00.000Z",
          deck: { title: "Deck" },
        }),
      } as Response
    }) as typeof fetch

    const result = await requestPptWorkerPreview({
      requestId: "req_1",
      prompt: "Build deck",
      researchBrief: {
        topic: "Hormuz Strait shipping risk 2026",
        keyFacts: ["War-risk premiums rose"],
      },
      scenario: "sales-deck",
      language: "zh-CN",
      model: "gpt-5.4",
      runtimeSlideModel: "gpt-5.4",
      runtimeSlideProvider: "pptoken",
      templateMode: "auto-4",
      narrativeAngle: "executive-brief",
      images: [{ url: "https://example.com/cover.png", role: "cover" }],
      allowMockFallback: true,
    })

    assert.equal(result.previewSessionId, "session_1")
    assert.equal(seen[0]?.url, "https://ppt-worker.example.com/preview")
    assert.equal(seen[0]?.method, "POST")
    assert.match(seen[0]?.body || "", /"runtimeProfile":"railway-linux"/)
    assert.match(seen[0]?.body || "", /"allowMockFallback":true/)
    assert.match(seen[0]?.body || "", /"researchBrief":\{"topic":"Hormuz Strait shipping risk 2026"/)
    assert.match(seen[0]?.body || "", /"model":"deepseek-v4-pro"/)
    assert.match(seen[0]?.body || "", /"runtimeSlideModel":"gpt-6\.1-sol"/)
    assert.match(seen[0]?.body || "", /"runtimeSlideProvider":"pptoken"/)
    assert.match(seen[0]?.body || "", /"narrativeAngle":"executive-brief"/)
    assert.match(seen[0]?.body || "", /"images":\[\{"url":"https:\/\/example.com\/cover\.png","role":"cover"\}\]/)
    assert.equal(seen[0]?.auth, "Bearer secret-token")
    assert.equal(seen[1]?.url, "https://ppt-worker.example.com/preview-jobs/job_1")
    assert.equal(seen[1]?.method, "GET")
  } finally {
    global.fetch = originalFetch

    if (previousBaseUrl === undefined) {
      delete process.env.PPT_WORKER_BASE_URL
    } else {
      process.env.PPT_WORKER_BASE_URL = previousBaseUrl
    }

    if (previousToken === undefined) {
      delete process.env.PPT_WORKER_INTERNAL_TOKEN
    } else {
      process.env.PPT_WORKER_INTERNAL_TOKEN = previousToken
    }

    if (previousProfile === undefined) {
      delete process.env.PPT_WORKER_RUNTIME_PROFILE
    } else {
      process.env.PPT_WORKER_RUNTIME_PROFILE = previousProfile
    }

    if (previousPollInterval === undefined) {
      delete process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS
    } else {
      process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS = previousPollInterval
    }

    if (previousTimeout === undefined) {
      delete process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS
    } else {
      process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS = previousTimeout
    }
  }
})

test("ppt worker preview defaults missing templateMode to auto-4 before posting", async () => {
  const originalFetch = global.fetch
  const previousBaseUrl = process.env.PPT_WORKER_BASE_URL
  const previousPollInterval = process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS
  const previousTimeout = process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS

  try {
    process.env.PPT_WORKER_BASE_URL = "https://ppt-worker.example.com/"
    process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS = "1"
    process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS = "1000"

    const seenBodies: string[] = []
    global.fetch = (async (input, init) => {
      if (String(input).endsWith("/preview")) {
        seenBodies.push(String(init?.body || ""))
        return {
          ok: true,
          status: 202,
          json: async () => ({
            jobId: "job_default_mode",
            status: "queued",
          }),
        } as Response
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          jobId: "job_default_mode",
          status: "completed",
          previewSessionId: "session_default_mode",
          generatedAt: "2026-06-24T00:00:00.000Z",
          deck: { title: "Deck" },
        }),
      } as Response
    }) as typeof fetch

    const result = await requestPptWorkerPreview({
      requestId: "req_default_mode",
      prompt: "Build deck",
      scenario: "sales-deck",
      language: "zh-CN",
      allowMockFallback: false,
    })

    assert.equal(result.previewSessionId, "session_default_mode")
    assert.match(seenBodies[0] || "", /"templateMode":"auto-4"/)
  } finally {
    global.fetch = originalFetch

    if (previousBaseUrl === undefined) {
      delete process.env.PPT_WORKER_BASE_URL
    } else {
      process.env.PPT_WORKER_BASE_URL = previousBaseUrl
    }

    if (previousPollInterval === undefined) {
      delete process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS
    } else {
      process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS = previousPollInterval
    }

    if (previousTimeout === undefined) {
      delete process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS
    } else {
      process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS = previousTimeout
    }
  }
})

test("ppt worker preview retries transient fetch failures", async () => {
  const originalFetch = global.fetch
  const previousBaseUrl = process.env.PPT_WORKER_BASE_URL
  const previousPollInterval = process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS
  const previousTimeout = process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS
  const previousMaxAttempts = process.env.PPT_WORKER_PREVIEW_MAX_ATTEMPTS
  const previousRetryDelay = process.env.PPT_WORKER_PREVIEW_RETRY_DELAY_MS

  try {
    process.env.PPT_WORKER_BASE_URL = "https://ppt-worker.example.com"
    process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS = "1"
    process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS = "1000"
    process.env.PPT_WORKER_PREVIEW_MAX_ATTEMPTS = "2"
    process.env.PPT_WORKER_PREVIEW_RETRY_DELAY_MS = "1"

    let calls = 0
    global.fetch = (async (input) => {
      calls += 1
      if (calls === 1) {
        throw new Error("fetch failed")
      }
      if (String(input).endsWith("/preview")) {
        return {
          ok: true,
          status: 202,
          json: async () => ({ jobId: "job_retry", status: "queued" }),
        } as Response
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          jobId: "job_retry",
          status: "completed",
          previewSessionId: "session_retry",
          generatedAt: "2026-06-24T00:00:00.000Z",
          deck: { title: "Retried deck" },
        }),
      } as Response
    }) as typeof fetch

    const result = await requestPptWorkerPreview({
      requestId: "req_fetch_retry",
      prompt: "Build deck",
      scenario: "training",
      language: "zh-CN",
      templateMode: "auto-4",
      allowMockFallback: false,
    })

    assert.equal(result.previewSessionId, "session_retry")
    assert.equal(calls, 3)
  } finally {
    global.fetch = originalFetch

    if (previousBaseUrl === undefined) {
      delete process.env.PPT_WORKER_BASE_URL
    } else {
      process.env.PPT_WORKER_BASE_URL = previousBaseUrl
    }
    if (previousPollInterval === undefined) {
      delete process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS
    } else {
      process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS = previousPollInterval
    }
    if (previousTimeout === undefined) {
      delete process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS
    } else {
      process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS = previousTimeout
    }
    if (previousMaxAttempts === undefined) {
      delete process.env.PPT_WORKER_PREVIEW_MAX_ATTEMPTS
    } else {
      process.env.PPT_WORKER_PREVIEW_MAX_ATTEMPTS = previousMaxAttempts
    }
    if (previousRetryDelay === undefined) {
      delete process.env.PPT_WORKER_PREVIEW_RETRY_DELAY_MS
    } else {
      process.env.PPT_WORKER_PREVIEW_RETRY_DELAY_MS = previousRetryDelay
    }
  }
})

test("ppt worker preview rejects templates unsupported by the deployed worker before posting", async () => {
  const originalFetch = global.fetch
  const previousBaseUrl = process.env.PPT_WORKER_BASE_URL

  try {
    process.env.PPT_WORKER_BASE_URL = "https://ppt-worker.example.com"
    let fetchCalled = false
    global.fetch = (async () => {
      fetchCalled = true
      throw new Error("fetch_should_not_be_called")
    }) as typeof fetch

    await assert.rejects(
      requestPptWorkerPreview({
        requestId: "req_unsupported_template",
        prompt: "Build deck",
        scenario: "training",
        language: "zh-CN",
        templateMode: "single-template",
        templateId: "worker-unsupported-template",
        allowMockFallback: false,
      }),
      /ppt_worker_template_unsupported:worker-unsupported-template/,
    )
    assert.equal(fetchCalled, false)
  } finally {
    global.fetch = originalFetch

    if (previousBaseUrl === undefined) {
      delete process.env.PPT_WORKER_BASE_URL
    } else {
      process.env.PPT_WORKER_BASE_URL = previousBaseUrl
    }
  }
})

test("ppt worker preview surfaces template enum errors from worker bad_request payloads", async () => {
  const originalFetch = global.fetch
  const previousBaseUrl = process.env.PPT_WORKER_BASE_URL

  try {
    process.env.PPT_WORKER_BASE_URL = "https://ppt-worker.example.com"
    global.fetch = (async () =>
      ({
        ok: false,
        status: 400,
        json: async () => ({
          message: "bad_request",
          issues: [
            {
              received: "academic-defense",
              code: "invalid_enum_value",
              path: ["templateId"],
              message: "Invalid enum value.",
            },
          ],
        }),
      }) as Response) as typeof fetch

    await assert.rejects(
      requestPptWorkerPreviewSubmit({
        requestId: "req_worker_bad_request",
        prompt: "Build deck",
        scenario: "training",
        language: "zh-CN",
        templateMode: "auto-4",
        allowMockFallback: false,
      }),
      /ppt_worker_template_unsupported:academic-defense/,
    )
  } finally {
    global.fetch = originalFetch

    if (previousBaseUrl === undefined) {
      delete process.env.PPT_WORKER_BASE_URL
    } else {
      process.env.PPT_WORKER_BASE_URL = previousBaseUrl
    }
  }
})

test("ppt worker preview preserves supported worker models", async () => {
  const originalFetch = global.fetch
  const previousBaseUrl = process.env.PPT_WORKER_BASE_URL
  const previousPollInterval = process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS
  const previousTimeout = process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS

  try {
    process.env.PPT_WORKER_BASE_URL = "https://ppt-worker.example.com"
    process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS = "1"
    process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS = "1000"

    let requestBody = ""
    global.fetch = (async (input, init) => {
      if (String(input).endsWith("/preview")) {
        requestBody = String(init?.body || "")
        return {
          ok: true,
          status: 202,
          json: async () => ({
            jobId: "job_2",
            status: "queued",
          }),
        } as Response
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          jobId: "job_2",
          status: "completed",
          previewSessionId: "session_2",
          generatedAt: "2026-06-24T00:00:00.000Z",
          deck: { title: "Deck" },
        }),
      } as Response
    }) as typeof fetch

    await requestPptWorkerPreview({
      requestId: "req_supported_model",
      prompt: "Build deck",
      scenario: "sales-deck",
      language: "zh-CN",
      model: "MiniMax-M2.7-highspeed",
      templateMode: "auto-4",
      allowMockFallback: false,
    })

    assert.match(requestBody, /"model":"MiniMax-M2\.7-highspeed"/)
  } finally {
    global.fetch = originalFetch

    if (previousBaseUrl === undefined) {
      delete process.env.PPT_WORKER_BASE_URL
    } else {
      process.env.PPT_WORKER_BASE_URL = previousBaseUrl
    }

    if (previousPollInterval === undefined) {
      delete process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS
    } else {
      process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS = previousPollInterval
    }

    if (previousTimeout === undefined) {
      delete process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS
    } else {
      process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS = previousTimeout
    }
  }
})

test("ppt worker preview preserves DeepSeek v4 pro for remote worker requests", async () => {
  const originalFetch = global.fetch
  const previousBaseUrl = process.env.PPT_WORKER_BASE_URL
  const previousPollInterval = process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS
  const previousTimeout = process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS

  try {
    process.env.PPT_WORKER_BASE_URL = "https://ppt-worker.example.com"
    process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS = "1"
    process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS = "1000"

    let requestBody = ""
    global.fetch = (async (input, init) => {
      if (String(input).endsWith("/preview")) {
        requestBody = String(init?.body || "")
        return {
          ok: true,
          status: 202,
          json: async () => ({
            jobId: "job_deepseek_v4_pro",
            status: "queued",
          }),
        } as Response
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          jobId: "job_deepseek_v4_pro",
          status: "completed",
          previewSessionId: "session_deepseek_v4_pro",
          generatedAt: "2026-06-24T00:00:00.000Z",
          deck: { title: "Deck" },
        }),
      } as Response
    }) as typeof fetch

    await requestPptWorkerPreview({
      requestId: "req_deepseek_v4_pro",
      prompt: "Build deck",
      scenario: "sales-deck",
      language: "zh-CN",
      model: "deepseek-v4-pro",
      templateMode: "auto-4",
      allowMockFallback: false,
    })

    assert.match(requestBody, /"model":"deepseek-v4-pro"/)
  } finally {
    global.fetch = originalFetch

    if (previousBaseUrl === undefined) {
      delete process.env.PPT_WORKER_BASE_URL
    } else {
      process.env.PPT_WORKER_BASE_URL = previousBaseUrl
    }

    if (previousPollInterval === undefined) {
      delete process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS
    } else {
      process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS = previousPollInterval
    }

    if (previousTimeout === undefined) {
      delete process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS
    } else {
      process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS = previousTimeout
    }
  }
})

test("ppt worker export posts selected variant and decodes success payload", async () => {
  const originalFetch = global.fetch
  const previousBaseUrl = process.env.PPT_WORKER_BASE_URL

  try {
    process.env.PPT_WORKER_BASE_URL = "https://ppt-worker.example.com"

    let seen: { url?: string; body?: string } = {}
    global.fetch = (async (input, init) => {
      seen = {
        url: String(input),
        body: String(init?.body || ""),
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          fileName: "deck.pptx",
          contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          slideCount: 8,
          variantName: "Variant A",
          bufferBase64: Buffer.from("ppt-bytes").toString("base64"),
        }),
      } as Response
    }) as typeof fetch

    const result = await requestPptWorkerExport({
      requestId: "req_export_1",
      previewSessionId: "session_1",
      selectedVariantKey: "variant_a",
    })

    assert.equal(result.fileName, "deck.pptx")
    assert.equal(seen.url, "https://ppt-worker.example.com/export")
    assert.match(seen.body || "", /"selectedVariantKey":"variant_a"/)
  } finally {
    global.fetch = originalFetch

    if (previousBaseUrl === undefined) {
      delete process.env.PPT_WORKER_BASE_URL
    } else {
      process.env.PPT_WORKER_BASE_URL = previousBaseUrl
    }
  }
})

test("ppt worker preview fails clearly when base url is missing", async () => {
  const previousBaseUrl = process.env.PPT_WORKER_BASE_URL

  try {
    delete process.env.PPT_WORKER_BASE_URL

    await assert.rejects(
      () =>
        requestPptWorkerPreview({
          requestId: "req_missing_url",
          prompt: "Build deck",
          researchBrief: "Use live search findings",
          scenario: "sales-deck",
          language: "zh-CN",
          templateMode: "auto-4",
          allowMockFallback: false,
        }),
      /ppt_worker_base_url_missing/,
    )
  } finally {
    if (previousBaseUrl === undefined) {
      delete process.env.PPT_WORKER_BASE_URL
    } else {
      process.env.PPT_WORKER_BASE_URL = previousBaseUrl
    }
  }
})

test("ppt worker preview surfaces failed async jobs", async () => {
  const originalFetch = global.fetch
  const previousBaseUrl = process.env.PPT_WORKER_BASE_URL
  const previousPollInterval = process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS
  const previousTimeout = process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS

  try {
    process.env.PPT_WORKER_BASE_URL = "https://ppt-worker.example.com"
    process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS = "1"
    process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS = "1000"

    global.fetch = (async (input) => {
      if (String(input).endsWith("/preview")) {
        return {
          ok: true,
          status: 202,
          json: async () => ({
            jobId: "job_failed",
            status: "queued",
          }),
        } as Response
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          jobId: "job_failed",
          status: "failed",
          message: "provider_quota_exceeded",
        }),
      } as Response
    }) as typeof fetch

    await assert.rejects(
      () =>
        requestPptWorkerPreview({
          requestId: "req_failed",
          prompt: "Build deck",
          scenario: "sales-deck",
          language: "zh-CN",
          templateMode: "auto-4",
          allowMockFallback: false,
        }),
      /provider_quota_exceeded/,
    )
  } finally {
    global.fetch = originalFetch

    if (previousBaseUrl === undefined) {
      delete process.env.PPT_WORKER_BASE_URL
    } else {
      process.env.PPT_WORKER_BASE_URL = previousBaseUrl
    }

    if (previousPollInterval === undefined) {
      delete process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS
    } else {
      process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS = previousPollInterval
    }

    if (previousTimeout === undefined) {
      delete process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS
    } else {
      process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS = previousTimeout
    }
  }
})

test("ppt worker preview retries transient runtime-unavailable failures once", async () => {
  const originalFetch = global.fetch
  const previousBaseUrl = process.env.PPT_WORKER_BASE_URL
  const previousPollInterval = process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS
  const previousTimeout = process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS
  const previousMaxAttempts = process.env.PPT_WORKER_PREVIEW_MAX_ATTEMPTS
  const previousRetryDelay = process.env.PPT_WORKER_PREVIEW_RETRY_DELAY_MS

  try {
    process.env.PPT_WORKER_BASE_URL = "https://ppt-worker.example.com"
    process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS = "1"
    process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS = "1000"
    process.env.PPT_WORKER_PREVIEW_MAX_ATTEMPTS = "2"
    process.env.PPT_WORKER_PREVIEW_RETRY_DELAY_MS = "1"

    const seen: string[] = []
    let previewCalls = 0

    global.fetch = (async (input) => {
      const url = String(input)
      seen.push(url)

      if (url.endsWith("/preview")) {
        previewCalls += 1
        return {
          ok: true,
          status: 202,
          json: async () => ({
            jobId: `job_${previewCalls}`,
            status: "queued",
          }),
        } as Response
      }

      if (url.endsWith("/preview-jobs/job_1")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            jobId: "job_1",
            status: "failed",
            message: "ppt_master_runtime_unavailable",
          }),
        } as Response
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          jobId: "job_2",
          status: "completed",
          previewSessionId: "session_retry_success",
          generatedAt: "2026-07-03T03:35:39.969Z",
          deck: { title: "Recovered Deck" },
        }),
      } as Response
    }) as typeof fetch

    const result = await requestPptWorkerPreview({
      requestId: "req_retry_runtime_unavailable",
      prompt: "Build deck",
      scenario: "sales-deck",
      language: "zh-CN",
      templateMode: "auto-4",
      allowMockFallback: false,
    })

    assert.equal(result.previewSessionId, "session_retry_success")
    assert.equal(previewCalls, 2)
    assert.deepEqual(seen, [
      "https://ppt-worker.example.com/preview",
      "https://ppt-worker.example.com/preview-jobs/job_1",
      "https://ppt-worker.example.com/preview",
      "https://ppt-worker.example.com/preview-jobs/job_2",
    ])
  } finally {
    global.fetch = originalFetch

    if (previousBaseUrl === undefined) {
      delete process.env.PPT_WORKER_BASE_URL
    } else {
      process.env.PPT_WORKER_BASE_URL = previousBaseUrl
    }

    if (previousPollInterval === undefined) {
      delete process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS
    } else {
      process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS = previousPollInterval
    }

    if (previousTimeout === undefined) {
      delete process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS
    } else {
      process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS = previousTimeout
    }

    if (previousMaxAttempts === undefined) {
      delete process.env.PPT_WORKER_PREVIEW_MAX_ATTEMPTS
    } else {
      process.env.PPT_WORKER_PREVIEW_MAX_ATTEMPTS = previousMaxAttempts
    }

    if (previousRetryDelay === undefined) {
      delete process.env.PPT_WORKER_PREVIEW_RETRY_DELAY_MS
    } else {
      process.env.PPT_WORKER_PREVIEW_RETRY_DELAY_MS = previousRetryDelay
    }
  }
})
