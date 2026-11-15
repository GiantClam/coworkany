import assert from "node:assert/strict"
import { test } from "node:test"

import { parseRunRequest, parseSessionRunRequest } from "./run-contract"

const provider = {
  providerId: "deepseek" as const,
  modelId: "deepseek-v4-pro",
  baseUrl: "https://deepseek.example/v1",
  apiKey: "test-key",
}

function input(runId: string) {
  return {
    runId,
    conversationId: null,
    enterpriseId: null,
    userId: 1,
    agentId: "business-content-growth",
    systemPrompt: "system",
    messages: [{ role: "user", content: "hello" }],
    attachments: [],
    artifactContext: [],
    workflowContext: null,
    artifactContract: {
      manifestPath: "artifact-manifest.json",
      artifactDir: "artifacts",
      maxArtifacts: 1,
      maxArtifactBytes: 100,
      maxArtifactTotalBytes: 100,
      allowedExtensions: [".md"],
    },
    policy: { allowPlatformTools: false, allowTools: false, allowMcp: false, allowSkillInstall: false, allowNetwork: true },
  }
}

test("requires an external provider for one-shot and session runtime requests", () => {
  const runId = "11111111-1111-4111-8111-111111111111"
  const oneShot = { runId, input: input(runId), timeoutMs: 10_000, provider }
  assert.equal(parseRunRequest(JSON.stringify(oneShot)).provider.apiKey, "test-key")
  assert.throws(() => parseRunRequest(JSON.stringify({ ...oneShot, provider: undefined })), /run_request_provider_required/)

  const sessionKey = "sess-" + "a".repeat(40)
  const sessionInput = { ...input(runId), protocolVersion: 2, sessionKey, functionId: "business-content-growth", selectedSkillIds: [], selectedMcpServerIds: [], attachmentObjects: [], checkpoint: null }
  const session = { runId, sessionKey, input: sessionInput, deadlineMs: 3_600_000, provider }
  assert.equal(parseSessionRunRequest(JSON.stringify(session)).provider.baseUrl, provider.baseUrl)
  assert.throws(() => parseSessionRunRequest(JSON.stringify({ ...session, provider: undefined })), /session_run_request_invalid/)
})

test("accepts an application-defined provider without a runtime allowlist", () => {
  const runId = "22222222-2222-4222-8222-222222222222"
  const customProvider = { ...provider, providerId: "company-gateway" }
  const parsed = parseRunRequest(JSON.stringify({ runId, input: input(runId), timeoutMs: 10_000, provider: customProvider }))
  assert.equal(parsed.provider.providerId, "company-gateway")
})

test("rejects retired GPT and Claude models at the Cloudflare runtime boundary", () => {
  const runId = "33333333-3333-4333-8333-333333333333"
  assert.throws(
    () => parseRunRequest(JSON.stringify({ runId, input: input(runId), timeoutMs: 10_000, provider: { ...provider, modelId: "gpt-5.7-sol" } })),
    /run_request_provider_required/,
  )
  assert.throws(
    () => parseSessionRunRequest(JSON.stringify({
      runId,
      sessionKey: "sess-" + "b".repeat(40),
      input: { ...input(runId), protocolVersion: 2, sessionKey: "sess-" + "b".repeat(40), functionId: "business-content-growth", selectedSkillIds: [], selectedMcpServerIds: [], attachmentObjects: [], checkpoint: null },
      deadlineMs: 3_600_000,
      provider: { ...provider, modelId: "claude-sonnet-5.1" },
    })),
    /session_run_request_invalid/,
  )
})
