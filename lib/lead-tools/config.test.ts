import assert from "node:assert/strict"
import test from "node:test"

import {
  allowLeadToolPptRuntimeProviderFallback,
  allowPptMasterEmergencyFallback,
  getLeadToolPptExecutionTransport,
  getLeadToolPreviewModel,
  getLeadToolPptPreviewRuntime,
  getLeadToolPptPreviewProvider,
  getLeadToolPptRuntimeSlideModel,
  getLeadToolPptRuntimeSlideProvider,
  getLeadToolPptRuntimeFallbackModel,
  getLeadToolPptRuntimeFallbackProvider,
  getPptMasterSlideTimeoutMs,
  resolvePptMasterSlideTimeoutMs,
  getPptWorkerBaseUrl,
  getPptWorkerInternalToken,
  getPptWorkerPreviewMaxAttempts,
  getPptWorkerPreviewPollIntervalMs,
  getPptWorkerPreviewRetryDelayMs,
  getPptWorkerPreviewTimeoutMs,
  getPptWorkerRuntimeProfile,
} from "./config"

test("ai-ppt-preview defaults to frontend-slides preview runtime", () => {
  const originalPreviewRuntime = process.env.LEAD_TOOLS_PPT_PREVIEW_RUNTIME
  const originalGlobalRuntime = process.env.LEAD_TOOLS_PREVIEW_RUNTIME
  const originalWorkerBaseUrl = process.env.PPT_WORKER_BASE_URL

  try {
    delete process.env.LEAD_TOOLS_PPT_PREVIEW_RUNTIME
    delete process.env.LEAD_TOOLS_PREVIEW_RUNTIME
    delete process.env.PPT_WORKER_BASE_URL

    assert.equal(getLeadToolPptPreviewRuntime("ai-ppt-preview"), "frontend-slides-agent")
  } finally {
    if (originalPreviewRuntime === undefined) {
      delete process.env.LEAD_TOOLS_PPT_PREVIEW_RUNTIME
    } else {
      process.env.LEAD_TOOLS_PPT_PREVIEW_RUNTIME = originalPreviewRuntime
    }

    if (originalGlobalRuntime === undefined) {
      delete process.env.LEAD_TOOLS_PREVIEW_RUNTIME
    } else {
      process.env.LEAD_TOOLS_PREVIEW_RUNTIME = originalGlobalRuntime
    }

    if (originalWorkerBaseUrl === undefined) {
      delete process.env.PPT_WORKER_BASE_URL
    } else {
      process.env.PPT_WORKER_BASE_URL = originalWorkerBaseUrl
    }
  }
})

test("ai-ppt-preview defaults to deepseek v4 pro for planning", () => {
  const previousPptPreviewModel = process.env.LEAD_TOOLS_PPT_PREVIEW_MODEL
  const previousGlobalPreviewModel = process.env.LEAD_TOOLS_PREVIEW_MODEL

  try {
    delete process.env.LEAD_TOOLS_PPT_PREVIEW_MODEL
    delete process.env.LEAD_TOOLS_PREVIEW_MODEL

    assert.equal(getLeadToolPreviewModel("ai-ppt-preview"), "deepseek-v4-pro")
  } finally {
    if (previousPptPreviewModel === undefined) {
      delete process.env.LEAD_TOOLS_PPT_PREVIEW_MODEL
    } else {
      process.env.LEAD_TOOLS_PPT_PREVIEW_MODEL = previousPptPreviewModel
    }

    if (previousGlobalPreviewModel === undefined) {
      delete process.env.LEAD_TOOLS_PREVIEW_MODEL
    } else {
      process.env.LEAD_TOOLS_PREVIEW_MODEL = previousGlobalPreviewModel
    }
  }
})

test("anonymous SEO title generation defaults to deepseek v4 flash", () => {
  const previousTitleModel = process.env.LEAD_TOOLS_SEO_TITLE_PREVIEW_MODEL
  const previousSeoModel = process.env.LEAD_TOOLS_SEO_PREVIEW_MODEL
  const previousGlobalModel = process.env.LEAD_TOOLS_PREVIEW_MODEL

  try {
    delete process.env.LEAD_TOOLS_SEO_TITLE_PREVIEW_MODEL
    delete process.env.LEAD_TOOLS_SEO_PREVIEW_MODEL
    delete process.env.LEAD_TOOLS_PREVIEW_MODEL

    assert.equal(getLeadToolPreviewModel("seo-title-generator"), "deepseek-v4-flash")
  } finally {
    if (previousTitleModel === undefined) delete process.env.LEAD_TOOLS_SEO_TITLE_PREVIEW_MODEL
    else process.env.LEAD_TOOLS_SEO_TITLE_PREVIEW_MODEL = previousTitleModel
    if (previousSeoModel === undefined) delete process.env.LEAD_TOOLS_SEO_PREVIEW_MODEL
    else process.env.LEAD_TOOLS_SEO_PREVIEW_MODEL = previousSeoModel
    if (previousGlobalModel === undefined) delete process.env.LEAD_TOOLS_PREVIEW_MODEL
    else process.env.LEAD_TOOLS_PREVIEW_MODEL = previousGlobalModel
  }
})

test("ppt execution transport defaults to local", () => {
  const previousTransport = process.env.LEAD_TOOLS_PPT_EXECUTION_TRANSPORT
  const previousBaseUrl = process.env.PPT_WORKER_BASE_URL

  try {
    delete process.env.LEAD_TOOLS_PPT_EXECUTION_TRANSPORT
    delete process.env.PPT_WORKER_BASE_URL

    assert.equal(getLeadToolPptExecutionTransport(), "local")
  } finally {
    if (previousTransport === undefined) {
      delete process.env.LEAD_TOOLS_PPT_EXECUTION_TRANSPORT
    } else {
      process.env.LEAD_TOOLS_PPT_EXECUTION_TRANSPORT = previousTransport
    }

    if (previousBaseUrl === undefined) {
      delete process.env.PPT_WORKER_BASE_URL
    } else {
      process.env.PPT_WORKER_BASE_URL = previousBaseUrl
    }
  }
})

test("ppt worker config reads base url token and runtime profile", () => {
  const previousBaseUrl = process.env.PPT_WORKER_BASE_URL
  const previousToken = process.env.PPT_WORKER_INTERNAL_TOKEN
  const previousProfile = process.env.PPT_WORKER_RUNTIME_PROFILE
  const previousPollInterval = process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS
  const previousTimeout = process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS
  const previousMaxAttempts = process.env.PPT_WORKER_PREVIEW_MAX_ATTEMPTS
  const previousRetryDelay = process.env.PPT_WORKER_PREVIEW_RETRY_DELAY_MS

  try {
    process.env.PPT_WORKER_BASE_URL = "https://ppt-worker.example.com/"
    process.env.PPT_WORKER_INTERNAL_TOKEN = "secret-token"
    process.env.PPT_WORKER_RUNTIME_PROFILE = "railway-linux"
    process.env.PPT_WORKER_PREVIEW_POLL_INTERVAL_MS = "1500"
    process.env.PPT_WORKER_PREVIEW_TIMEOUT_MS = "120000"
    process.env.PPT_WORKER_PREVIEW_MAX_ATTEMPTS = "3"
    process.env.PPT_WORKER_PREVIEW_RETRY_DELAY_MS = "750"

    assert.equal(getPptWorkerBaseUrl(), "https://ppt-worker.example.com/")
    assert.equal(getPptWorkerInternalToken(), "secret-token")
    assert.equal(getPptWorkerRuntimeProfile(), "railway-linux")
    assert.equal(getPptWorkerPreviewPollIntervalMs(), 1500)
    assert.equal(getPptWorkerPreviewTimeoutMs(), 120000)
    assert.equal(getPptWorkerPreviewMaxAttempts(), 3)
    assert.equal(getPptWorkerPreviewRetryDelayMs(), 750)
  } finally {
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

test("vercel production defaults to the canonical Railway PPT worker", () => {
  const mutableEnv = process.env as Record<string, string | undefined>
  const previousBaseUrl = process.env.PPT_WORKER_BASE_URL
  const previousNodeEnv = process.env.NODE_ENV
  const previousVercel = process.env.VERCEL
  const previousVercelEnv = process.env.VERCEL_ENV
  const previousTransport = process.env.LEAD_TOOLS_PPT_EXECUTION_TRANSPORT
  const previousPreviewRuntime = process.env.LEAD_TOOLS_PPT_PREVIEW_RUNTIME

  try {
    delete process.env.PPT_WORKER_BASE_URL
    mutableEnv.NODE_ENV = "production"
    delete process.env.VERCEL
    delete process.env.VERCEL_ENV
    process.env.LEAD_TOOLS_PPT_EXECUTION_TRANSPORT = "local"
    process.env.LEAD_TOOLS_PPT_PREVIEW_RUNTIME = "frontend-slides-agent"

    assert.equal(getPptWorkerBaseUrl(), "https://ppt-master-worker-production.up.railway.app")
    assert.equal(getPptWorkerRuntimeProfile(), "railway-linux")
    assert.equal(getLeadToolPptExecutionTransport(), "remote-worker")
    assert.equal(getLeadToolPptPreviewRuntime("ai-ppt-preview"), "ppt-master-agent")
  } finally {
    if (previousBaseUrl === undefined) {
      delete process.env.PPT_WORKER_BASE_URL
    } else {
      process.env.PPT_WORKER_BASE_URL = previousBaseUrl
    }

    if (previousNodeEnv === undefined) {
      delete mutableEnv.NODE_ENV
    } else {
      mutableEnv.NODE_ENV = previousNodeEnv
    }

    if (previousVercel === undefined) {
      delete process.env.VERCEL
    } else {
      process.env.VERCEL = previousVercel
    }

    if (previousVercelEnv === undefined) {
      delete process.env.VERCEL_ENV
    } else {
      process.env.VERCEL_ENV = previousVercelEnv
    }

    if (previousTransport === undefined) {
      delete process.env.LEAD_TOOLS_PPT_EXECUTION_TRANSPORT
    } else {
      process.env.LEAD_TOOLS_PPT_EXECUTION_TRANSPORT = previousTransport
    }

    if (previousPreviewRuntime === undefined) {
      delete process.env.LEAD_TOOLS_PPT_PREVIEW_RUNTIME
    } else {
      process.env.LEAD_TOOLS_PPT_PREVIEW_RUNTIME = previousPreviewRuntime
    }
  }
})

test("ppt worker runtime profile infers railway-linux from a railway worker url", () => {
  const previousBaseUrl = process.env.PPT_WORKER_BASE_URL
  const previousProfile = process.env.PPT_WORKER_RUNTIME_PROFILE

  try {
    process.env.PPT_WORKER_BASE_URL = "https://ppt-master-worker-production.up.railway.app"
    delete process.env.PPT_WORKER_RUNTIME_PROFILE

    assert.equal(getPptWorkerRuntimeProfile(), "railway-linux")
  } finally {
    if (previousBaseUrl === undefined) {
      delete process.env.PPT_WORKER_BASE_URL
    } else {
      process.env.PPT_WORKER_BASE_URL = previousBaseUrl
    }

    if (previousProfile === undefined) {
      delete process.env.PPT_WORKER_RUNTIME_PROFILE
    } else {
      process.env.PPT_WORKER_RUNTIME_PROFILE = previousProfile
    }
  }
})

test("ppt worker base url upgrades preview runtime and transport defaults", () => {
  const previousBaseUrl = process.env.PPT_WORKER_BASE_URL
  const previousTransport = process.env.LEAD_TOOLS_PPT_EXECUTION_TRANSPORT
  const previousPreviewRuntime = process.env.LEAD_TOOLS_PPT_PREVIEW_RUNTIME
  const previousGlobalRuntime = process.env.LEAD_TOOLS_PREVIEW_RUNTIME

  try {
    process.env.PPT_WORKER_BASE_URL = "https://ppt-worker.example.com/"
    delete process.env.LEAD_TOOLS_PPT_EXECUTION_TRANSPORT
    delete process.env.LEAD_TOOLS_PPT_PREVIEW_RUNTIME
    delete process.env.LEAD_TOOLS_PREVIEW_RUNTIME

    assert.equal(getLeadToolPptExecutionTransport(), "remote-worker")
    assert.equal(getLeadToolPptPreviewRuntime("ai-ppt-preview"), "ppt-master-agent")
  } finally {
    if (previousBaseUrl === undefined) {
      delete process.env.PPT_WORKER_BASE_URL
    } else {
      process.env.PPT_WORKER_BASE_URL = previousBaseUrl
    }

    if (previousTransport === undefined) {
      delete process.env.LEAD_TOOLS_PPT_EXECUTION_TRANSPORT
    } else {
      process.env.LEAD_TOOLS_PPT_EXECUTION_TRANSPORT = previousTransport
    }

    if (previousPreviewRuntime === undefined) {
      delete process.env.LEAD_TOOLS_PPT_PREVIEW_RUNTIME
    } else {
      process.env.LEAD_TOOLS_PPT_PREVIEW_RUNTIME = previousPreviewRuntime
    }

    if (previousGlobalRuntime === undefined) {
      delete process.env.LEAD_TOOLS_PREVIEW_RUNTIME
    } else {
      process.env.LEAD_TOOLS_PREVIEW_RUNTIME = previousGlobalRuntime
    }
  }
})

test("ppt runtime slide config defaults to GPT-6.1 Sol and prefers explicit overrides", () => {
  const previousTimeout = process.env.PPT_MASTER_SLIDE_TIMEOUT_MS
  const previousScopedTimeout = process.env.PPT_MASTER_SLIDE_TIMEOUT_MS_PPTOKEN
  const previousScopedModelTimeout = process.env.PPT_MASTER_SLIDE_TIMEOUT_MS_PPTOKEN_GPT_6_1_SOL
  const previousRuntimeScopedTimeout = process.env.LEAD_TOOLS_PPT_RUNTIME_SLIDE_TIMEOUT_MS
  const previousFallback = process.env.PPT_MASTER_ALLOW_EMERGENCY_FALLBACK
  const previousRuntimeSlideModel = process.env.LEAD_TOOLS_PPT_RUNTIME_SLIDE_MODEL
  const previousRuntimeSlideProvider = process.env.LEAD_TOOLS_PPT_RUNTIME_SLIDE_PROVIDER
  const previousPreviewProvider = process.env.LEAD_TOOLS_PPT_PREVIEW_PROVIDER

  try {
    delete process.env.PPT_MASTER_SLIDE_TIMEOUT_MS
    delete process.env.PPT_MASTER_SLIDE_TIMEOUT_MS_PPTOKEN
    delete process.env.PPT_MASTER_SLIDE_TIMEOUT_MS_PPTOKEN_GPT_6_1_SOL
    delete process.env.LEAD_TOOLS_PPT_RUNTIME_SLIDE_TIMEOUT_MS
    delete process.env.PPT_MASTER_ALLOW_EMERGENCY_FALLBACK
    delete process.env.LEAD_TOOLS_PPT_RUNTIME_SLIDE_MODEL
    delete process.env.LEAD_TOOLS_PPT_RUNTIME_SLIDE_PROVIDER
    delete process.env.LEAD_TOOLS_PPT_PREVIEW_PROVIDER

    assert.equal(getPptMasterSlideTimeoutMs(), 12 * 60 * 1000)
    assert.equal(resolvePptMasterSlideTimeoutMs({ provider: "pptoken", model: "gpt-6.1-sol" }), 12 * 60 * 1000)
    assert.equal(allowPptMasterEmergencyFallback(), false)
    assert.equal(getLeadToolPptRuntimeSlideModel(), "gpt-6.1-sol")
    assert.equal(getLeadToolPptRuntimeSlideProvider(), "")
    assert.equal(getLeadToolPptPreviewProvider(), "")

    process.env.PPT_MASTER_SLIDE_TIMEOUT_MS = "180000"
    process.env.PPT_MASTER_ALLOW_EMERGENCY_FALLBACK = "true"
    process.env.LEAD_TOOLS_PPT_RUNTIME_SLIDE_MODEL = "gpt-6.1-sol"
    process.env.LEAD_TOOLS_PPT_RUNTIME_SLIDE_PROVIDER = "glm"
    process.env.LEAD_TOOLS_PPT_PREVIEW_PROVIDER = "minimax"

    assert.equal(getPptMasterSlideTimeoutMs(), 180000)
    assert.equal(resolvePptMasterSlideTimeoutMs({ provider: "pptoken", model: "gpt-6.1-sol" }), 180000)

    process.env.LEAD_TOOLS_PPT_RUNTIME_SLIDE_TIMEOUT_MS = "240000"
    assert.equal(resolvePptMasterSlideTimeoutMs({ provider: "pptoken", model: "gpt-6.1-sol" }), 240000)

    process.env.PPT_MASTER_SLIDE_TIMEOUT_MS_PPTOKEN = "300000"
    assert.equal(resolvePptMasterSlideTimeoutMs({ provider: "pptoken", model: "gpt-6.1-sol" }), 300000)

    process.env.PPT_MASTER_SLIDE_TIMEOUT_MS_PPTOKEN_GPT_6_1_SOL = "420000"
    assert.equal(resolvePptMasterSlideTimeoutMs({ provider: "pptoken", model: "gpt-6.1-sol" }), 420000)
    assert.equal(allowPptMasterEmergencyFallback(), true)
    assert.equal(getLeadToolPptRuntimeSlideModel(), "gpt-6.1-sol")
    assert.equal(getLeadToolPptRuntimeSlideProvider(), "glm")
    assert.equal(getLeadToolPptPreviewProvider(), "minimax")
  } finally {
    if (previousTimeout === undefined) {
      delete process.env.PPT_MASTER_SLIDE_TIMEOUT_MS
    } else {
      process.env.PPT_MASTER_SLIDE_TIMEOUT_MS = previousTimeout
    }

    if (previousScopedTimeout === undefined) {
      delete process.env.PPT_MASTER_SLIDE_TIMEOUT_MS_PPTOKEN
    } else {
      process.env.PPT_MASTER_SLIDE_TIMEOUT_MS_PPTOKEN = previousScopedTimeout
    }

    if (previousScopedModelTimeout === undefined) {
      delete process.env.PPT_MASTER_SLIDE_TIMEOUT_MS_PPTOKEN_GPT_6_1_SOL
    } else {
      process.env.PPT_MASTER_SLIDE_TIMEOUT_MS_PPTOKEN_GPT_6_1_SOL = previousScopedModelTimeout
    }

    if (previousRuntimeScopedTimeout === undefined) {
      delete process.env.LEAD_TOOLS_PPT_RUNTIME_SLIDE_TIMEOUT_MS
    } else {
      process.env.LEAD_TOOLS_PPT_RUNTIME_SLIDE_TIMEOUT_MS = previousRuntimeScopedTimeout
    }

    if (previousFallback === undefined) {
      delete process.env.PPT_MASTER_ALLOW_EMERGENCY_FALLBACK
    } else {
      process.env.PPT_MASTER_ALLOW_EMERGENCY_FALLBACK = previousFallback
    }

    if (previousRuntimeSlideModel === undefined) {
      delete process.env.LEAD_TOOLS_PPT_RUNTIME_SLIDE_MODEL
    } else {
      process.env.LEAD_TOOLS_PPT_RUNTIME_SLIDE_MODEL = previousRuntimeSlideModel
    }

    if (previousRuntimeSlideProvider === undefined) {
      delete process.env.LEAD_TOOLS_PPT_RUNTIME_SLIDE_PROVIDER
    } else {
      process.env.LEAD_TOOLS_PPT_RUNTIME_SLIDE_PROVIDER = previousRuntimeSlideProvider
    }

    if (previousPreviewProvider === undefined) {
      delete process.env.LEAD_TOOLS_PPT_PREVIEW_PROVIDER
    } else {
      process.env.LEAD_TOOLS_PPT_PREVIEW_PROVIDER = previousPreviewProvider
    }
  }
})

test("ppt preview provider accepts deepseek explicit override", () => {
  const previousPreviewProvider = process.env.LEAD_TOOLS_PPT_PREVIEW_PROVIDER

  try {
    process.env.LEAD_TOOLS_PPT_PREVIEW_PROVIDER = "deepseek"
    assert.equal(getLeadToolPptPreviewProvider(), "deepseek")
  } finally {
    if (previousPreviewProvider === undefined) {
      delete process.env.LEAD_TOOLS_PPT_PREVIEW_PROVIDER
    } else {
      process.env.LEAD_TOOLS_PPT_PREVIEW_PROVIDER = previousPreviewProvider
    }
  }
})

test("ppt runtime provider fallback defaults to MiniMax and can be disabled", () => {
  const previousEnabled = process.env.LEAD_TOOLS_PPT_RUNTIME_FALLBACK_ENABLED
  const previousProvider = process.env.LEAD_TOOLS_PPT_RUNTIME_FALLBACK_PROVIDER
  const previousModel = process.env.LEAD_TOOLS_PPT_RUNTIME_FALLBACK_MODEL

  try {
    delete process.env.LEAD_TOOLS_PPT_RUNTIME_FALLBACK_ENABLED
    delete process.env.LEAD_TOOLS_PPT_RUNTIME_FALLBACK_PROVIDER
    delete process.env.LEAD_TOOLS_PPT_RUNTIME_FALLBACK_MODEL

    assert.equal(allowLeadToolPptRuntimeProviderFallback(), true)
    assert.equal(getLeadToolPptRuntimeFallbackProvider(), "minimax")
    assert.equal(getLeadToolPptRuntimeFallbackModel(), "MiniMax-M2.7-highspeed")

    process.env.LEAD_TOOLS_PPT_RUNTIME_FALLBACK_ENABLED = "false"
    process.env.LEAD_TOOLS_PPT_RUNTIME_FALLBACK_PROVIDER = "pptoken"
    process.env.LEAD_TOOLS_PPT_RUNTIME_FALLBACK_MODEL = "custom-model"
    assert.equal(allowLeadToolPptRuntimeProviderFallback(), false)
    assert.equal(getLeadToolPptRuntimeFallbackProvider(), "minimax")
    assert.equal(getLeadToolPptRuntimeFallbackModel(), "custom-model")
  } finally {
    if (previousEnabled === undefined) delete process.env.LEAD_TOOLS_PPT_RUNTIME_FALLBACK_ENABLED
    else process.env.LEAD_TOOLS_PPT_RUNTIME_FALLBACK_ENABLED = previousEnabled
    if (previousProvider === undefined) delete process.env.LEAD_TOOLS_PPT_RUNTIME_FALLBACK_PROVIDER
    else process.env.LEAD_TOOLS_PPT_RUNTIME_FALLBACK_PROVIDER = previousProvider
    if (previousModel === undefined) delete process.env.LEAD_TOOLS_PPT_RUNTIME_FALLBACK_MODEL
    else process.env.LEAD_TOOLS_PPT_RUNTIME_FALLBACK_MODEL = previousModel
  }
})
