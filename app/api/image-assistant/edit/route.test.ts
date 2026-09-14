import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"

const require = createRequire(import.meta.url)
const nodeModule = require("node:module") as {
  _load: (request: string, parent: unknown, isMain: boolean) => unknown
}
const originalLoad = nodeModule._load

type ConversationTurnParams = {
  userId: number
  enterpriseId?: number | null
  enterpriseRole?: string | null
  enterpriseStatus?: string | null
  requestIp: string
  sessionId?: string | null
  prompt: string
  taskType: "generate" | "edit" | "mask_edit"
  referenceAssetIds?: string[]
  snapshotAssetId?: string | null
  maskAssetId?: string | null
  modelOptionId?: string | null
  providerLock?: "pptoken" | "aiberm" | "crazyroute" | null
  model?: string | null
  candidateCount?: number
  sizePreset?: string | null
  resolution?: string | null
  parentVersionId?: string | null
  guidedSelection?: {
    source_message_id?: string | null
    question_id?: string | null
    option_id?: string | null
  } | null
}

let runTurnCalls: ConversationTurnParams[] = []
let enqueueCalls = 0
let enqueuePayload: Record<string, any> | null = null
let shouldFailSessionDetail = false

nodeModule._load = function patchedModuleLoad(request: string, parent: unknown, isMain: boolean) {
  if (request === "next/server") {
    return {
      NextResponse: {
        json: (body: unknown, init?: { status?: number }) => ({
          status: init?.status || 200,
          body,
        }),
      },
    }
  }
  if (request === "@/lib/auth/guards") {
    return {
      requireSessionUser: async () => ({
        user: { id: 7, enterpriseId: null },
      }),
    }
  }
  if (request === "@/lib/assistant-async") {
    return {
      ensureImageAssistantSessionForTask: async () => ({
        sessionId: "s-1",
      }),
      enqueueAssistantTask: async (input: { payload: Record<string, any> }) => {
        enqueueCalls += 1
        enqueuePayload = input.payload
        return { id: "task-1" }
      },
    }
  }
  if (request === "@/lib/platform/model-governance") {
    return {
      resolveGovernedImageAssistantSelectionForUser: async (input: {
        modelOptionId?: string | null
        model?: string | null
      }) => {
        const optionId = input.modelOptionId || "workspace:pptoken:gpt-image-2"
        const providerId = optionId.includes(":aiberm:") ? "aiberm" : optionId.includes(":crazyroute:") ? "crazyroute" : "pptoken"
        return {
          source: "workspace",
          modelOptionId: optionId,
          providerId,
          providerLabel: providerId,
          providerLock: providerId,
          model: input.model || "gpt-image-2",
          modelOptions: [],
          providerOptions: [],
          enterpriseRuntime: null,
        }
      },
    }
  }
  if (request === "@/lib/image-assistant/service") {
    return {
      runImageAssistantConversationTurn: async (params: ConversationTurnParams) => {
        runTurnCalls.push(params)
        return {
          outcome: "generated",
          version_id: "v-2",
          follow_up_message_id: null,
        }
      },
    }
  }
  if (request === "@/lib/image-assistant/repository") {
    return {
      listImageAssistantAssets: async () => [{ id: "asset-1", asset_type: "generated" }],
      getImageAssistantSessionDetail: async () => {
        if (shouldFailSessionDetail) {
          throw new Error("Failed query: timeout exceeded when trying to connect")
        }
        return {
          session: { id: "s-1", current_version_id: "v-2" },
          messages: [],
          versions: [],
          assets: [],
          canvas_document: null,
          meta: {
            messages_total: 0,
            messages_loaded: 0,
            messages_has_more: false,
            messages_next_cursor: null,
            versions_total: 0,
            versions_loaded: 0,
            versions_has_more: false,
            versions_next_cursor: null,
          },
        }
      },
    }
  }
  if (request === "@/lib/server/rate-limit") {
    return {
      createRateLimitResponse: () => ({
        status: 429,
        body: { error: "rate_limited" },
      }),
      getRequestIp: () => "127.0.0.1",
    }
  }

  return originalLoad.call(this, request, parent, isMain)
}

let POST: (req: { json: () => Promise<Record<string, unknown>> }) => Promise<{ status: number; body: any }>

test.before(async () => {
  const route = await import("./route")
  POST = route.POST as unknown as (req: { json: () => Promise<Record<string, unknown>> }) => Promise<{ status: number; body: any }>
})

test.beforeEach(() => {
  runTurnCalls = []
  enqueueCalls = 0
  enqueuePayload = null
  shouldFailSessionDetail = false
})

test.after(() => {
  nodeModule._load = originalLoad
})

test("edit route keeps direct success when detail read is temporarily unavailable", async () => {
  shouldFailSessionDetail = true
  const response = await POST({
    json: async () => ({
      prompt: "upscale this image to 4k",
      sessionId: "s-1",
      referenceAssetIds: ["asset-1"],
      modelOptionId: "workspace:crazyroute:gpt-image-2",
      candidateCount: 1,
      preferAsync: false,
    }),
  })

  assert.equal(response.status, 200)
  assert.equal(runTurnCalls.length, 1)
  assert.equal(runTurnCalls[0].taskType, "edit")
  assert.deepEqual(runTurnCalls[0].referenceAssetIds, ["asset-1"])
  assert.equal(runTurnCalls[0].modelOptionId, "workspace:crazyroute:gpt-image-2")
  assert.equal(runTurnCalls[0].providerLock, "crazyroute")
  assert.equal(response.body?.data?.accepted, true)
  assert.equal(response.body?.data?.direct, true)
  assert.equal(response.body?.data?.detail_snapshot, null)
  assert.equal(enqueueCalls, 0)
})

test("edit route preserves mask context for direct mask edits", async () => {
  const response = await POST({
    json: async () => ({
      prompt: "remove the marked object",
      sessionId: "s-1",
      referenceAssetIds: ["asset-1"],
      snapshotAssetId: "snapshot-1",
      maskAssetId: "mask-1",
      candidateCount: 1,
      preferAsync: false,
    }),
  })

  assert.equal(response.status, 200)
  assert.equal(runTurnCalls.length, 1)
  assert.equal(runTurnCalls[0].taskType, "mask_edit")
  assert.deepEqual(runTurnCalls[0].referenceAssetIds, ["asset-1", "snapshot-1", "mask-1"])
  assert.equal(runTurnCalls[0].snapshotAssetId, "snapshot-1")
  assert.equal(runTurnCalls[0].maskAssetId, "mask-1")
})

test("edit route preserves mask context for queued mask edits", async () => {
  const response = await POST({
    json: async () => ({
      prompt: "remove the marked object",
      sessionId: "s-1",
      referenceAssetIds: ["asset-1"],
      snapshotAssetId: "snapshot-1",
      maskAssetId: "mask-1",
      candidateCount: 1,
      preferAsync: true,
    }),
  })

  assert.equal(response.status, 200)
  assert.equal(enqueueCalls, 1)
  assert.equal(enqueuePayload?.taskType, "mask_edit")
  assert.deepEqual(enqueuePayload?.referenceAssetIds, ["asset-1", "snapshot-1", "mask-1"])
  assert.equal(enqueuePayload?.snapshotAssetId, "snapshot-1")
  assert.equal(enqueuePayload?.maskAssetId, "mask-1")
})
