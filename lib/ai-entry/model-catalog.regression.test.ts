import assert from "node:assert/strict"
import test from "node:test"

import { getAiEntryModelCatalog } from "./model-catalog"

const serialTest = (name: string, run: () => Promise<void>) =>
  test(name, { concurrency: false }, run)

const PROVIDER_ENV_KEYS = [
  "AI_ENTRY_DEEPSEEK_API_KEY",
  "AI_ENTRY_DEEPSEEK_BASE_URL",
  "AI_ENTRY_DEEPSEEK_MODEL",
  "AI_ENTRY_PPTOKEN_API_KEY",
  "AI_ENTRY_PPTOKEN_BASE_URL",
  "AI_ENTRY_PPTOKEN_MODEL",
  "AI_ENTRY_PPTOKEN_GROK_API_KEY",
  "AI_ENTRY_PPTOKEN_GROK_BASE_URL",
  "AI_ENTRY_OPENROUTER_ENABLED",
  "AI_ENTRY_OPENROUTER_API_KEY",
  "AI_ENTRY_OPENROUTER_BASE_URL",
  "AI_ENTRY_OPENROUTER_MODEL",
  "AI_ENTRY_AIBERM_API_KEY",
  "AI_ENTRY_AIBERM_BASE_URL",
  "AI_ENTRY_AIBERM_MODEL",
  "AI_ENTRY_CRAZYROUTE_API_KEY",
  "AI_ENTRY_CRAZYROUTE_BASE_URL",
  "AI_ENTRY_CRAZYROUTE_MODEL",
  "AI_ENTRY_NORMAL_DEFAULT_MODEL",
  "AI_ENTRY_NORMAL_FAST_MODEL",
  "AI_ENTRY_MODEL_RECENT_DAYS",
  "PPTOKEN_API_KEY",
  "PPTOKEN_BASE_URL",
  "PPTOKEN_MODEL",
  "PPTOKEN_GROK_API_KEY",
  "PPTOKEN_GROK_BASE_URL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "OPENROUTER_TEXT_MODEL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "DEEPSEEK_MODEL",
  "AIBERM_API_KEY",
  "AIBERM_BASE_URL",
  "CRAZYROUTE_API_KEY",
  "CRAZYROUTER_API_KEY",
  "CRAZYROUTE_BASE_URL",
  "CRAZYROUTER_BASE_URL",
] as const

let providerEnvLock = Promise.resolve()

serialTest("model catalog keeps deepseek-v4-pro visible for the deepseek provider", async () => {
  await withProviderEnv(
    {
      AI_ENTRY_DEEPSEEK_API_KEY: "deepseek-key",
      AI_ENTRY_DEEPSEEK_BASE_URL: "https://api.deepseek.example",
      AI_ENTRY_DEEPSEEK_MODEL: "deepseek-v4-pro",
    },
    async () => {
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith("https://api.deepseek.example/models")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [{ id: "deepseek-v4-pro", owned_by: "deepseek" }],
            }),
          } as Response
        }

        throw new Error(`unexpected url: ${url}`)
      }) as unknown as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog({ providerId: "deepseek" })
        assert.equal(catalog.providerId, "deepseek")
        assert.equal(catalog.selectedProviderId, "deepseek")
        assert.equal(catalog.selectedModelId, "deepseek-v4-pro")
        assert.equal(catalog.models.some((item) => item.id === "deepseek-v4-pro"), true)
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})

serialTest("model catalog only advertises PPToken Grok when the Grok account is configured", async () => {
  await withProviderEnv(
    {
      AI_ENTRY_PPTOKEN_API_KEY: "gpt-account-key",
      AI_ENTRY_PPTOKEN_BASE_URL: "https://gpt.pptoken.example/v1",
      AI_ENTRY_PPTOKEN_MODEL: "gpt-6.1-sol",
    },
    async () => {
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: "gpt-6.1-sol", owned_by: "openai" }] }),
      })) as unknown as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog({ providerId: "pptoken" })
        assert.equal(catalog.models.some((item) => item.id === "grok-4.5"), false)
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )

  await withProviderEnv(
    {
      AI_ENTRY_PPTOKEN_API_KEY: "gpt-account-key",
      AI_ENTRY_PPTOKEN_BASE_URL: "https://gpt.pptoken.example/v1",
      AI_ENTRY_PPTOKEN_MODEL: "gpt-6.1-sol",
      AI_ENTRY_PPTOKEN_GROK_API_KEY: "grok-account-key",
      AI_ENTRY_PPTOKEN_GROK_BASE_URL: "https://grok.pptoken.example/v1",
    },
    async () => {
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({ data: [{ id: "gpt-6.1-sol", owned_by: "openai" }] }),
      })) as unknown as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog({ providerId: "pptoken" })
        assert.equal(catalog.models.some((item) => item.id === "grok-4.5"), true)

        const unscopedCatalog = await getAiEntryModelCatalog()
        assert.equal(unscopedCatalog.models.some((item) => item.id === "grok-4.5"), true)
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})

function resetCatalogState() {
  ;(globalThis as { __aiEntryModelCatalogCacheV2__?: unknown }).__aiEntryModelCatalogCacheV2__ =
    undefined
  ;(globalThis as { __aiEntryProviderRoutingStateV1__?: unknown }).__aiEntryProviderRoutingStateV1__ =
    undefined
}

async function withProviderEnv<T>(
  overrides: Partial<Record<(typeof PROVIDER_ENV_KEYS)[number], string>>,
  run: () => Promise<T>,
) {
  const previousLock = providerEnvLock
  let releaseLock: (() => void) | undefined
  providerEnvLock = new Promise<void>((resolve) => {
    releaseLock = resolve
  })
  await previousLock

  const previous = new Map<string, string | undefined>()
  for (const key of PROVIDER_ENV_KEYS) {
    previous.set(key, process.env[key])
    process.env[key] = ""
  }

  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value
  }

  resetCatalogState()
  try {
    return await run()
  } finally {
    for (const key of PROVIDER_ENV_KEYS) {
      const oldValue = previous.get(key)
      if (typeof oldValue === "string") {
        process.env[key] = oldValue
      } else {
        delete process.env[key]
      }
    }
    resetCatalogState()
    releaseLock?.()
  }
}

serialTest("model catalog selects configured default model when /models omits it", async () => {
  await withProviderEnv(
    {
      AI_ENTRY_AIBERM_API_KEY: "test-key",
      AI_ENTRY_AIBERM_BASE_URL: "https://aiberm.example/v1",
      AI_ENTRY_AIBERM_MODEL: "openai/gpt-6.1-sol",
    },
    async () => {
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "aiberm/image-model", name: "Image Model" },
            { id: "aiberm/audio-model", name: "Audio Model" },
          ],
        }),
      })) as unknown as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog()
        assert.equal(catalog.providerId, "aiberm")
        assert.equal(catalog.selectedModelId, "gpt-6.1-sol")
        assert.equal(catalog.models[0]?.id, "gpt-6.1-sol")
        assert.equal(catalog.models.length, 1)
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})

serialTest("model catalog does not duplicate configured default model when already present", async () => {
  await withProviderEnv(
    {
      AI_ENTRY_AIBERM_API_KEY: "test-key",
      AI_ENTRY_AIBERM_BASE_URL: "https://aiberm.example/v1",
      AI_ENTRY_AIBERM_MODEL: "openai/gpt-6.1-sol",
    },
    async () => {
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "openai/gpt-6.1-sol", name: "GPT 6.1 Sol" },
            { id: "openai/gpt-6.1-sol", name: "GPT 6.1 Sol" },
          ],
        }),
      })) as unknown as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog()
        assert.equal(catalog.selectedModelId, "gpt-6.1-sol")
        assert.equal(
          catalog.models.filter((item) => item.id === "gpt-6.1-sol").length,
          1,
        )
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})

serialTest("model catalog selects fast sonnet as normal chat default when no configured model is present", async () => {
  await withProviderEnv(
    {
      AI_ENTRY_AIBERM_API_KEY: "test-key",
      AI_ENTRY_AIBERM_BASE_URL: "https://aiberm.example/v1",
      AI_ENTRY_NORMAL_FAST_MODEL: "claude-sonnet-6.1",
    },
    async () => {
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "claude-haiku-6.1", name: "Claude Haiku 6.1" },
            { id: "claude-sonnet-6.1-thinking", name: "Claude Sonnet 6.1 Thinking" },
            { id: "claude-sonnet-6.1", name: "Claude Sonnet 6.1" },
          ],
        }),
      })) as unknown as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog()
        assert.equal(catalog.providerId, "aiberm")
        assert.equal(catalog.selectedModelId, "claude-sonnet-6.1")
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})

serialTest("model catalog product policy overrides stale provider haiku default", async () => {
  await withProviderEnv(
    {
      AI_ENTRY_AIBERM_API_KEY: "test-key",
      AI_ENTRY_AIBERM_BASE_URL: "https://aiberm.example/v1",
      AI_ENTRY_AIBERM_MODEL: "claude-haiku-5.0",
    },
    async () => {
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "claude-haiku-5.0", name: "Claude Haiku 5.0" },
            { id: "claude-sonnet-6.1", name: "Claude Sonnet 6.1" },
          ],
        }),
      })) as unknown as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog()
        assert.equal(catalog.selectedModelId, "claude-sonnet-6.1")
        assert.equal(
          catalog.models.some((item) => item.id === "claude-haiku-5.0"),
          false,
        )
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})

serialTest("model catalog keeps high-tier model families and prioritized order", async () => {
  await withProviderEnv(
    {
      AI_ENTRY_AIBERM_API_KEY: "test-key",
      AI_ENTRY_AIBERM_BASE_URL: "https://aiberm.example/v1",
      AI_ENTRY_AIBERM_MODEL: "openai/gpt-6.1-sol",
    },
    async () => {
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "meta/llama-4-maverick", name: "Llama Maverick" },
            { id: "openai/gpt-6.1-sol", name: "GPT 6.1 Sol" },
            { id: "anthropic/claude-opus-6.1", name: "Claude Opus 6.1" },
            { id: "google/gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
            { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
            { id: "openai/text-embedding-3-large", name: "Embedding 3 Large" },
          ],
        }),
      })) as unknown as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog({ onlyRecentDays: null })
        assert.deepEqual(
          catalog.modelGroups.map((group) => group.family),
          ["anthropic", "openai", "gemini", "minimax"],
        )
        assert.equal(
          catalog.models.some((item) => item.id === "openai/text-embedding-3-large"),
          false,
        )
        assert.equal(
          catalog.models.some((item) => item.id === "meta/llama-4-maverick"),
          false,
        )
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})

serialTest("model catalog recent-year filter excludes old models when created is present", async () => {
  const nowSeconds = Math.floor(Date.now() / 1000)
  const oldSeconds = nowSeconds - 800 * 24 * 60 * 60

  await withProviderEnv(
    {
      AI_ENTRY_AIBERM_API_KEY: "test-key",
      AI_ENTRY_AIBERM_BASE_URL: "https://aiberm.example/v1",
      AI_ENTRY_AIBERM_MODEL: "openai/gpt-6.1-sol",
    },
    async () => {
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "openai/gpt-6.1-sol", name: "GPT 6.1 Sol", created: nowSeconds },
            { id: "openai/gpt-6-sol", name: "GPT 6 Sol", created: oldSeconds },
            { id: "anthropic/claude-sonnet-6.1", name: "Claude Sonnet 6.1" },
          ],
        }),
      })) as unknown as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog({ onlyRecentDays: 365 })
        assert.equal(catalog.models.some((item) => item.id === "gpt-6-sol"), false)
        assert.equal(catalog.models.some((item) => item.id === "gpt-6.1-sol"), true)
        assert.equal(
          catalog.models.some((item) => item.id === "anthropic/claude-sonnet-6.1"),
          true,
        )
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})

serialTest("model catalog strict recent filter excludes models without created timestamp", async () => {
  const nowSeconds = Math.floor(Date.now() / 1000)

  await withProviderEnv(
    {
      AI_ENTRY_AIBERM_API_KEY: "test-key",
      AI_ENTRY_AIBERM_BASE_URL: "https://aiberm.example/v1",
      AI_ENTRY_AIBERM_MODEL: "openai/gpt-6.1-sol",
    },
    async () => {
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "openai/gpt-6.1-sol", name: "GPT 6.1 Sol", created: nowSeconds },
            { id: "anthropic/claude-sonnet-6.1", name: "Claude Sonnet 6.1" },
          ],
        }),
      })) as unknown as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog({ onlyRecentDays: 365, recentStrict: true })
        assert.equal(catalog.models.some((item) => item.id === "gpt-6.1-sol"), true)
        assert.equal(catalog.models.some((item) => item.id === "claude-sonnet-6.1"), false)
        assert.equal(catalog.recentStrict, true)
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})

serialTest("model catalog falls back to unfiltered high-tier chat models when recent filter is empty in non-strict mode", async () => {
  const oldSeconds = Math.floor(Date.now() / 1000) - 800 * 24 * 60 * 60

  await withProviderEnv(
    {
      AI_ENTRY_AIBERM_API_KEY: "test-key",
      AI_ENTRY_AIBERM_BASE_URL: "https://aiberm.example/v1",
      AI_ENTRY_AIBERM_MODEL: "openai/gpt-6.1-sol",
    },
    async () => {
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "openai/gpt-6.1-sol", name: "GPT 6.1 Sol", created: oldSeconds },
            { id: "anthropic/claude-sonnet-6.1", name: "Claude Sonnet 6.1", created: oldSeconds },
          ],
        }),
      })) as unknown as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog({ onlyRecentDays: 365, recentStrict: false })
        assert.equal(catalog.models.length, 2)
        assert.deepEqual(
          catalog.modelGroups.map((group) => group.family),
          ["anthropic", "openai"],
        )
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})

serialTest("model catalog filters out non-target provider families under high-tier policy", async () => {
  await withProviderEnv(
    {
      AI_ENTRY_AIBERM_API_KEY: "test-key",
      AI_ENTRY_AIBERM_BASE_URL: "https://aiberm.example/v1",
      AI_ENTRY_AIBERM_MODEL: "openai/gpt-6.1-sol",
    },
    async () => {
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "qwen/qwen-max", name: "Qwen Max" },
            { id: "minimax/minimax-m1", name: "MiniMax M1" },
            { id: "zhipu/glm-4.5", name: "GLM 4.5" },
            { id: "moonshotai/kimi-k2", name: "Kimi K2" },
            { id: "openai/gpt-6.1-sol", name: "GPT 6.1 Sol" },
          ],
        }),
      })) as unknown as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog({ onlyRecentDays: null })
        assert.deepEqual(
          catalog.modelGroups.map((group) => group.family),
          ["openai"],
        )
        assert.equal(catalog.models.some((item) => item.id === "gpt-6.1-sol"), true)
        assert.equal(catalog.models.some((item) => item.id === "qwen/qwen-max"), false)
        assert.equal(catalog.models.some((item) => item.id === "minimax/minimax-m1"), false)
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})

serialTest("model catalog infers target families from bare ids and keeps only high-tier versions", async () => {
  await withProviderEnv(
    {
      AI_ENTRY_AIBERM_API_KEY: "test-key",
      AI_ENTRY_AIBERM_BASE_URL: "https://aiberm.example/v1",
      AI_ENTRY_AIBERM_MODEL: "gpt-6.1-sol",
    },
    async () => {
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "gpt-6-sol", owned_by: "custom" },
            { id: "claude-opus-6-1", owned_by: "custom" },
            { id: "gemini-3-flash-preview", owned_by: "custom" },
            { id: "qwen3-vl-plus", owned_by: "custom" },
            { id: "MiniMax-M2.7", owned_by: "custom" },
            { id: "glm-4.5-air", owned_by: "custom" },
            { id: "kimi-k2", owned_by: "custom" },
          ],
        }),
      })) as unknown as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog({ onlyRecentDays: null })
        assert.deepEqual(
          catalog.modelGroups.map((group) => group.family),
          ["anthropic", "openai", "gemini", "minimax"],
        )
        assert.equal(catalog.models.some((item) => item.id === "gpt-6-sol"), true)
        assert.equal(catalog.models.some((item) => item.id === "claude-opus-6.1"), true)
        assert.equal(catalog.models.some((item) => item.id === "gemini-3-flash-preview"), true)
        assert.equal(catalog.models.some((item) => item.id === "MiniMax-M2.7"), true)
        assert.equal(catalog.models.some((item) => item.id === "qwen3-vl-plus"), false)
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})

serialTest("model catalog keeps verified whitelist models for a configured provider", async () => {
  await withProviderEnv(
    {
      AI_ENTRY_AIBERM_API_KEY: "test-key",
      AI_ENTRY_AIBERM_BASE_URL: "https://aiberm.example/v1",
      AI_ENTRY_AIBERM_MODEL: "gpt-6.1-sol",
    },
    async () => {
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "gpt-6.1-sol", owned_by: "custom" },
            { id: "gpt-6-sol", owned_by: "custom" },
            { id: "claude-opus-6-7", owned_by: "custom" },
            { id: "gemini-3.1-pro-preview", owned_by: "custom" },
            { id: "claude-opus-4-4", owned_by: "custom" },
          ],
        }),
      })) as unknown as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog({
          onlyRecentDays: null,
          providerId: "aiberm",
        })
        assert.equal(catalog.models.some((item) => item.id === "gpt-6.1-sol"), true)
        assert.equal(catalog.models.some((item) => item.id === "gpt-6-sol"), true)
        assert.equal(catalog.models.some((item) => item.id === "claude-opus-6.7"), true)
        assert.equal(catalog.models.some((item) => item.id === "gemini-3.1-pro-preview"), true)
        assert.equal(catalog.models.some((item) => item.id === "claude-opus-4-4"), false)
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})

serialTest("model catalog can load crazyroute and inject verified whitelist models", async () => {
  await withProviderEnv(
    {
      AI_ENTRY_AIBERM_API_KEY: "test-key-a",
      AI_ENTRY_AIBERM_BASE_URL: "https://aiberm.example/v1",
      AI_ENTRY_AIBERM_MODEL: "gpt-6.1-sol",
      AI_ENTRY_CRAZYROUTE_API_KEY: "test-key-c",
      AI_ENTRY_CRAZYROUTE_BASE_URL: "https://crazy.example/v1",
      AI_ENTRY_CRAZYROUTE_MODEL: "gpt-6-sol",
    },
    async () => {
      const calls: string[] = []
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
        calls.push(url)
        if (url.startsWith("https://crazy.example/v1/models")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                { id: "gpt-6.1-sol", owned_by: "custom" },
                { id: "gpt-6-sol", owned_by: "custom" },
                { id: "claude-opus-6-7", owned_by: "custom" },
                { id: "gemini-3-flash-preview", owned_by: "custom" },
              ],
            }),
          } as Response
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: "gpt-6.1-sol", owned_by: "custom" }] }),
        } as Response
      }) as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog({
          onlyRecentDays: null,
          providerId: "crazyroute",
        })
        assert.equal(catalog.providerId, "crazyroute")
        assert.equal(catalog.models.some((item) => item.id === "gpt-6.1-sol"), true)
        assert.equal(catalog.models.some((item) => item.id === "gpt-6-sol"), true)
        assert.equal(catalog.models.some((item) => item.id === "claude-opus-6.7"), true)
        assert.equal(catalog.models.some((item) => item.id === "gemini-3-flash-preview"), true)
        assert.deepEqual(calls, ["https://crazy.example/v1/models"])
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})

serialTest("model catalog can be aggregated across configured providers", async () => {
  await withProviderEnv(
    {
      AI_ENTRY_PPTOKEN_API_KEY: "pptoken-key",
      AI_ENTRY_PPTOKEN_BASE_URL: "https://pptoken.example/v1",
      AI_ENTRY_PPTOKEN_MODEL: "gpt-6.1-sol",
      AI_ENTRY_OPENROUTER_API_KEY: "openrouter-key",
      AI_ENTRY_OPENROUTER_BASE_URL: "https://openrouter.example/v1",
      AI_ENTRY_OPENROUTER_MODEL: "grok-4.5",
      AI_ENTRY_AIBERM_API_KEY: "aiberm-key",
      AI_ENTRY_AIBERM_BASE_URL: "https://aiberm.example/v1",
      AI_ENTRY_AIBERM_MODEL: "claude-sonnet-6.1",
      AI_ENTRY_CRAZYROUTE_API_KEY: "crazy-key",
      AI_ENTRY_CRAZYROUTE_BASE_URL: "https://crazy.example/v1",
      AI_ENTRY_CRAZYROUTE_MODEL: "gemini-3.1-pro-preview",
    },
    async () => {
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async (input) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url

        if (url.startsWith("https://pptoken.example/v1/models")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                { id: "gpt-6.1-sol", owned_by: "openai" },
                { id: "gpt-6-sol", owned_by: "openai" },
              ],
            }),
          } as Response
        }

        if (url.startsWith("https://aiberm.example/v1/models")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                { id: "claude-sonnet-6.1", owned_by: "anthropic" },
                { id: "MiniMax-M2.7", owned_by: "minimax" },
              ],
            }),
          } as Response
        }

        if (url.startsWith("https://crazy.example/v1/models")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              data: [
                { id: "gemini-3.1-pro-preview", owned_by: "google" },
              ],
            }),
          } as Response
        }

        if (url.startsWith("https://openrouter.example/v1/models")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ data: [{ id: "x-ai/grok-4.5", owned_by: "x-ai" }] }),
          } as Response
        }

        return {
          ok: false,
          status: 404,
          text: async () => "not_found",
          json: async () => ({ error: "not_found" }),
        } as Response
      }) as typeof fetch

      try {
        const [pptokenCatalog, openrouterCatalog, aibermCatalog, crazyrouteCatalog] = await Promise.all([
          getAiEntryModelCatalog({ providerId: "pptoken" }),
          getAiEntryModelCatalog({ providerId: "openrouter" }),
          getAiEntryModelCatalog({ providerId: "aiberm" }),
          getAiEntryModelCatalog({ providerId: "crazyroute" }),
        ])

        const mergedGroups = new Map<string, Set<string>>()
        for (const catalog of [pptokenCatalog, openrouterCatalog, aibermCatalog, crazyrouteCatalog]) {
          for (const group of catalog.modelGroups) {
            const current = mergedGroups.get(group.family) || new Set<string>()
            for (const model of group.models) current.add(model.id)
            mergedGroups.set(group.family, current)
          }
        }

        assert.deepEqual([...mergedGroups.keys()], ["openai", "xai", "anthropic", "gemini", "minimax"])
        assert.equal(mergedGroups.get("xai")?.has("grok-4.5"), true)
        assert.equal(mergedGroups.get("openai")?.has("gpt-6.1-sol"), true)
        assert.equal(mergedGroups.get("anthropic")?.has("claude-sonnet-6.1"), true)
        assert.equal(mergedGroups.get("gemini")?.has("gemini-3.1-pro-preview"), true)
        assert.equal(mergedGroups.get("minimax")?.has("MiniMax-M2.7"), true)
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})

serialTest("model catalog keeps canonical bare id when provider and separator variants coexist", async () => {
  await withProviderEnv(
    {
      AI_ENTRY_AIBERM_API_KEY: "test-key",
      AI_ENTRY_AIBERM_BASE_URL: "https://aiberm.example/v1",
      AI_ENTRY_AIBERM_MODEL: "gpt-6.1-sol",
    },
    async () => {
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "gpt-6.1-sol", owned_by: "custom" },
            { id: "openai/gpt-6-1-sol", owned_by: "custom" },
            { id: "anthropic/claude-sonnet-6.1", owned_by: "custom" },
            { id: "claude-sonnet-6.1", owned_by: "custom" },
            { id: "gemini/gemini-3.1-pro-preview", owned_by: "custom" },
            { id: "MiniMax-M2.7-highspeed", owned_by: "custom" },
          ],
        }),
      })) as unknown as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog({ onlyRecentDays: null })
        assert.equal(catalog.models.some((item) => item.id === "gpt-6.1-sol"), true)
        assert.equal(
          catalog.models.some((item) => item.id === "openai/gpt-6-1-sol"),
          false,
        )
        assert.equal(catalog.models.some((item) => item.id === "claude-sonnet-6.1"), true)
        assert.equal(
          catalog.models.some((item) => item.id === "gemini-3.1-pro-preview"),
          true,
        )
        assert.equal(catalog.models.some((item) => item.id === "anthropic/claude-sonnet-6.1"), false)
        assert.equal(
          catalog.models.some((item) => item.id === "MiniMax-M2.7-highspeed"),
          false,
        )
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})

serialTest("model catalog filters retired GPT models and Claude thinking variants", async () => {
  await withProviderEnv(
    {
      AI_ENTRY_AIBERM_API_KEY: "test-key",
      AI_ENTRY_AIBERM_BASE_URL: "https://aiberm.example/v1",
      AI_ENTRY_AIBERM_MODEL: "claude-sonnet-6.1",
    },
    async () => {
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "anthropic/claude-sonnet-6.1", owned_by: "custom" },
            { id: "openai/gpt-5.3-codex", owned_by: "custom" },
            { id: "anthropic/claude-sonnet-6.1-thinking", owned_by: "custom" },
            { id: "openai/gpt-5.3-codex-thinking", owned_by: "custom" },
          ],
        }),
      })) as unknown as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog({ onlyRecentDays: null })
        assert.equal(catalog.models.some((item) => item.id === "openai/gpt-5.3-codex"), false)
        assert.equal(
          catalog.models.some((item) => item.id === "openai/gpt-5.3-codex-thinking"),
          false,
        )
        assert.equal(catalog.models.some((item) => item.id === "claude-sonnet-6.1"), true)
        assert.equal(catalog.models.some((item) => item.id === "anthropic/claude-sonnet-6.1"), false)
        assert.equal(
          catalog.models.some((item) => item.id === "anthropic/claude-sonnet-6.1-thinking"),
          false,
        )
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})

serialTest("model catalog keeps only the approved claude whitelist entries", async () => {
  await withProviderEnv(
    {
      AI_ENTRY_AIBERM_API_KEY: "test-key",
      AI_ENTRY_AIBERM_BASE_URL: "https://aiberm.example/v1",
      AI_ENTRY_AIBERM_MODEL: "claude-opus-6.1",
    },
    async () => {
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "claude-opus-6-1", owned_by: "custom" },
            { id: "claude-haiku-6-1-20261001", owned_by: "custom" },
            { id: "claude-opus-6-7", owned_by: "custom" },
            { id: "claude-opus-4-4", owned_by: "custom" },
            { id: "claude-4-6", owned_by: "custom" },
          ],
        }),
      })) as unknown as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog({ onlyRecentDays: null })
        assert.equal(catalog.models.some((item) => item.id === "claude-opus-6.1"), true)
        assert.equal(catalog.models.some((item) => item.id === "claude-opus-6.7"), true)
        assert.equal(catalog.models.some((item) => item.id === "claude-haiku-6.1"), true)
        assert.equal(
          catalog.models.some((item) => item.id === "claude-haiku-6-1-20261001"),
          false,
        )
        assert.equal(catalog.models.some((item) => item.id === "claude-opus-4-4"), false)
        assert.equal(catalog.models.some((item) => item.id === "claude-4-6"), false)
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})

serialTest("model catalog dedupes provider and separator variants across the approved families", async () => {
  await withProviderEnv(
    {
      AI_ENTRY_AIBERM_API_KEY: "test-key",
      AI_ENTRY_AIBERM_BASE_URL: "https://aiberm.example/v1",
      AI_ENTRY_AIBERM_MODEL: "gpt-6.1-sol",
    },
    async () => {
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "openai/gpt-6.1-sol", owned_by: "custom" },
            { id: "gpt-6-1-sol", owned_by: "custom" },
            { id: "google/gemini-3.1-pro-preview", owned_by: "custom" },
            { id: "gemini-3-1-pro-preview", owned_by: "custom" },
            { id: "anthropic/claude-opus-6.1", owned_by: "custom" },
            { id: "claude-opus-6-1", owned_by: "custom" },
          ],
        }),
      })) as unknown as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog({ onlyRecentDays: null })

        assert.equal(catalog.models.some((item) => item.id === "gpt-6.1-sol"), true)
        assert.equal(catalog.models.some((item) => item.id === "openai/gpt-6.1-sol"), false)

        assert.equal(catalog.models.some((item) => item.id === "gemini-3.1-pro-preview"), true)
        assert.equal(
          catalog.models.some((item) => item.id === "google/gemini-3.1-pro-preview"),
          false,
        )

        assert.equal(catalog.models.some((item) => item.id === "claude-opus-6.1"), true)
        assert.equal(
          catalog.models.some((item) => item.id === "anthropic/claude-opus-6.1"),
          false,
        )
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})

serialTest("model catalog falls back to crazyroute when aiberm is unavailable", async () => {
  await withProviderEnv(
    {
      AI_ENTRY_AIBERM_API_KEY: "aiberm-key",
      AI_ENTRY_AIBERM_BASE_URL: "https://aiberm.example/v1",
      AI_ENTRY_AIBERM_MODEL: "openai/gpt-6.1-sol",
      AI_ENTRY_CRAZYROUTE_API_KEY: "crazy-key",
      AI_ENTRY_CRAZYROUTE_BASE_URL: "https://crazy.example/v1",
      AI_ENTRY_CRAZYROUTE_MODEL: "openai/gpt-6-sol",
    },
    async () => {
      const calls: string[] = []
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async (
        input: RequestInfo | URL,
      ) => {
        const url = String(input)
        calls.push(url)

        if (url.startsWith("https://aiberm.example/v1/models")) {
          return {
            ok: false,
            status: 503,
            text: async () => "aiberm unavailable",
            json: async () => ({}),
          } as Response
        }

        if (url.startsWith("https://crazy.example/v1/models")) {
          return {
            ok: true,
            status: 200,
            text: async () => "",
            json: async () => ({
              data: [{ id: "openai/gpt-6-sol", name: "GPT 6 Sol" }],
            }),
          } as Response
        }

        return {
          ok: false,
          status: 404,
          text: async () => "not found",
          json: async () => ({}),
        } as Response
      }) as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog({ onlyRecentDays: null })
        assert.equal(catalog.providerId, "crazyroute")
        assert.equal(catalog.models.some((item) => item.id === "gpt-6-sol"), true)
        assert.equal(calls[0]?.includes("https://aiberm.example/v1/models"), true)
        assert.equal(calls.some((item) => item.includes("https://crazy.example/v1/models")), true)
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})

serialTest("model catalog falls back to configured default when aiberm and crazyroute are unavailable", async () => {
  await withProviderEnv(
    {
      AI_ENTRY_AIBERM_API_KEY: "aiberm-key",
      AI_ENTRY_AIBERM_BASE_URL: "https://aiberm.example/v1",
      AI_ENTRY_AIBERM_MODEL: "openai/gpt-6.1-sol",
      AI_ENTRY_CRAZYROUTE_API_KEY: "crazy-key",
      AI_ENTRY_CRAZYROUTE_BASE_URL: "https://crazy.example/v1",
      AI_ENTRY_CRAZYROUTE_MODEL: "openai/gpt-6-sol",
    },
    async () => {
      const calls: string[] = []
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async (
        input: RequestInfo | URL,
      ) => {
        const url = String(input)
        calls.push(url)

        if (url.startsWith("https://aiberm.example/v1/models")) {
          return {
            ok: false,
            status: 503,
            text: async () => "aiberm unavailable",
            json: async () => ({}),
          } as Response
        }

        if (url.startsWith("https://crazy.example/v1/models")) {
          return {
            ok: false,
            status: 502,
            text: async () => "crazyroute unavailable",
            json: async () => ({}),
          } as Response
        }

        return {
          ok: false,
          status: 404,
          text: async () => "not found",
          json: async () => ({}),
        } as Response
      }) as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog({ onlyRecentDays: null })
        assert.equal(catalog.providerId, "aiberm")
        assert.equal(catalog.models.some((item) => item.id === "openai/gpt-6.1-sol"), true)
        assert.equal(catalog.models.some((item) => item.id === "gpt-6-sol"), false)

        const modelCalls = calls.filter((item) => item.endsWith("/models"))
        assert.deepEqual(modelCalls, [
          "https://aiberm.example/v1/models",
          "https://crazy.example/v1/models",
        ])
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})

serialTest("model catalog explicitly filters retired GPT and Claude versions", async () => {
  await withProviderEnv(
    {
      AI_ENTRY_AIBERM_API_KEY: "test-key",
      AI_ENTRY_AIBERM_BASE_URL: "https://aiberm.example/v1",
    },
    async () => {
      const originalFetch = globalThis.fetch
      ;(globalThis as typeof globalThis & { fetch: typeof fetch }).fetch = (async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: "openai/gpt-6.1-sol", owned_by: "openai" },
            { id: "openai/gpt-5.6", owned_by: "openai" },
            { id: "openai/gpt-5.5", owned_by: "openai" },
            { id: "anthropic/claude-sonnet-6.1", owned_by: "anthropic" },
            { id: "anthropic/claude-sonnet-5.0", owned_by: "anthropic" },
            { id: "anthropic/claude-opus-4.6", owned_by: "anthropic" },
          ],
        }),
      })) as unknown as typeof fetch

      try {
        const catalog = await getAiEntryModelCatalog({ onlyRecentDays: null })
        assert.equal(catalog.models.some((item) => item.id === "gpt-6.1-sol"), true)
        assert.equal(
          catalog.models.some((item) => item.id === "anthropic/claude-sonnet-6.1"),
          true,
        )
        assert.equal(catalog.models.some((item) => item.id === "gpt-5.6"), false)
        assert.equal(catalog.models.some((item) => item.id === "gpt-5.5"), false)
        assert.equal(catalog.models.some((item) => item.id === "claude-sonnet-5.0"), false)
        assert.equal(catalog.models.some((item) => item.id === "claude-opus-4.6"), false)
      } finally {
        globalThis.fetch = originalFetch
      }
    },
  )
})
