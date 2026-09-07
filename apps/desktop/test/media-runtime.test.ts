import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHttpMediaAdapter, createMediaIdempotencyKey, downloadMediaOutputs, ProviderConfigurationRequiredError, requireMediaProvider, runMediaJob, type CancellationPort } from "@coworkany/media-runtime";

const provider = "fixture" as never;
const activeCancellation: CancellationPort = { throwIfCancelled: () => undefined };

test("media runtime preserves idempotency, polls and normalizes provider tasks", async () => {
  const requests: Array<{ url: string; method: string; body?: string }> = [];
  let pollCount = 0;
  const adapter = createHttpMediaAdapter({
    provider,
    baseUrl: "https://provider.test",
    apiKey: "fixture-secret",
    submitPath: "/submit",
    queryPath: (taskId) => `/tasks/${taskId}`,
    fetchImpl: async (input, init) => {
      requests.push({ url: String(input), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
      if (String(input).endsWith("/submit")) return new Response(JSON.stringify({ id: "task-1", status: "queued" }), { status: 200 });
      pollCount += 1;
      return new Response(JSON.stringify(pollCount === 1 ? { id: "task-1", status: "running" } : { id: "task-1", status: "succeeded", output: [{ url: "https://provider.test/result.png" }], usage: { input_tokens: 1, output_tokens: 2, estimated_cost: 0.03 } }), { status: 200 });
    },
  });
  const updates: string[] = [];
  const task = await runMediaJob(adapter, { provider, modelId: "fixture-model", input: { prompt: "hello" }, idempotencyKey: createMediaIdempotencyKey("run-1", "node-1", 1) }, activeCancellation, { pollIntervalMs: 1, timeoutMs: 1000, onUpdate: (value) => { updates.push(value.status); } });
  assert.equal(task.status, "succeeded");
  assert.deepEqual(task.usage, { inputTokens: 1, outputTokens: 2, estimatedCost: 0.03 });
  assert.deepEqual(updates, ["queued", "running", "succeeded"]);
  assert.equal(requests.length, 3);
  assert.equal(JSON.parse(requests[0].body ?? "{}").idempotency_key, "run-1:node-1:1");
  assert.equal(requests[0].method, "POST");
  assert.equal(requests[1].url, "https://provider.test/tasks/task-1");
});

test("media runtime downloads outputs atomically and rejects missing providers", async () => {
  assert.throws(() => requireMediaProvider(undefined, provider, "image"), (error: unknown) => error instanceof ProviderConfigurationRequiredError && error.code === "provider_configuration_required");
  const root = await mkdtemp(join(tmpdir(), "coworkany-media-runtime-"));
  try {
    const tempDirectory = join(root, "rust-allocated-temp");
    const artifacts = await downloadMediaOutputs({ providerTaskId: "task-2", status: "succeeded", outputs: [{ b64_json: Buffer.from("fixture-png").toString("base64") }] }, root, { filenamePrefix: "image", maxBytes: 1024, tempDirectory });
    assert.equal(artifacts.length, 1);
    assert.equal(await readFile(join(root, artifacts[0].relativePath), "utf8"), "fixture-png");
    assert.match(artifacts[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal(existsSync(tempDirectory), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop host emits terminal media attempt events for recovery idempotency", () => {
  const host = readFileSync(resolve(process.cwd(), "runtime/host.ts"), "utf8");
  const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(host, /phase: "completed"[\s\S]*status: "succeeded"/);
  assert.match(host, /const status = signal\?\.aborted/);
  assert.match(host, /task\.status !== "succeeded"[\s\S]*status: task\.status/);
  assert.match(host, /updated\.status === "succeeded" \? "submitted"/);
  assert.match(app, /mediaNodes = hostWorkflowDefinition\.nodes\.filter/);
  assert.match(app, /status: "queued", payloadJson/);
  assert.match(app, /status === "succeeded"[\s\S]*record_usage/);
  assert.match(host, /task\.usage/);
  assert.match(host, /status: "download_failed"/);
  assert.match(host, /!artifacts\.length && executorId !== "voice_clone"/);
  assert.match(host, /tempDirectory/);
  assert.match(host, /const persistedArtifacts = artifacts\.map/);
  assert.match(host, /join\("artifacts", runId\.replace/);
  assert.match(host, /artifacts: persistedArtifacts/);
  assert.match(app, /allocate_media_temp/);
  assert.match(app, /payload\.status === "download_failed"/);
  assert.match(host, /slice\(0, 64 \* 1024\)/);
  assert.match(app, /record_run_checkpoint/);
  assert.match(app, /const localizedFeatures = useMemo\(\(\) => mediaFeatureCatalog/);
  assert.match(app, /applyConfiguredMediaModels\(feature, models, model\)/);
  assert.match(app, /model: activeMediaModel/);
  assert.match(app, /const requestedModel = typeof resolvedMediaInputs\?\.model === "string"/);
  assert.match(app, /configuredModels\.includes\(requestedModel\)/);
  assert.match(app, /const isStandaloneMediaTask = Boolean\(mediaFeatureId && mediaFeatureId !== "image_generate"\)/);
  assert.match(app, /const routeConversationId = conversationIdFromPath\(launchPath\)/);
  assert.match(app, /const conversationId = isStandaloneMediaTask/);
  assert.match(app, /standaloneMediaRunsRef\.current\.add\(runId\)/);
});

test("desktop keeps large files and Provider credentials out of UI payload persistence", () => {
  const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  const upload = readFileSync(resolve(process.cwd(), "src/local-file-upload.ts"), "utf8");
  const host = readFileSync(resolve(process.cwd(), "runtime/host.ts"), "utf8");
  const tauriHost = readFileSync(resolve(process.cwd(), "src-tauri/src/host.rs"), "utf8");
  const logs = readFileSync(resolve(process.cwd(), "src-tauri/src/logs.rs"), "utf8");
  const lib = readFileSync(resolve(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
  assert.match(app, /persistLocalFile\(file, tauriBridge\)/);
  assert.match(upload, /LOCAL_ATTACHMENT_CHUNK_BYTES = 256 \* 1024/);
  assert.match(upload, /file\.slice\(offset, Math\.min\(file\.size, offset \+ LOCAL_ATTACHMENT_CHUNK_BYTES\)\)\.arrayBuffer\(\)/);
  assert.match(upload, /append_local_attachment_chunk/);
  assert.doesNotMatch(upload, /file\.stream\(\)/);
  assert.doesNotMatch(app, /readAsDataURL|btoa\(/);
  assert.match(tauriHost, /MAX_RUNTIME_MESSAGE_BYTES/);
  assert.doesNotMatch(host, /spawn\([^\n]*apiKey/);
  assert.match(logs, /api[_-]?key/iu);
  assert.match(lib, /config\.redacted\.json/);
  assert.match(lib, /\[REDACTED\]/);
});

test("desktop image capabilities select direct OpenAI-compatible or Bailian adapters", () => {
  const host = readFileSync(resolve(process.cwd(), "runtime/host.ts"), "utf8");
  const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(host, /createBailianImageAdapter\(providerOptions\)/);
  assert.match(host, /createOpenAICompatibleImageAdapter\(providerOptions\)/);
  assert.match(host, /executorId === "image_generate"/);
  assert.match(app, /mediaFeatureId === "image_generate"/);
  assert.match(app, /!mediaFeatureId && actionId !== "image_generate" &&/);
});

test("desktop video capabilities select shared MiniMax, Bailian and RunningHub clients", () => {
  const host = readFileSync(resolve(process.cwd(), "runtime/host.ts"), "utf8");
  const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(host, /createBailianVideoAdapter\(providerOptions\)/);
  assert.match(host, /createMiniMaxVideoAdapter\(providerOptions\)/);
  assert.match(host, /createRunningHubAdapter\(/);
  assert.match(host, /const configuredEndpoint =/);
  assert.match(host, /!registeredWorkflow && !configuredEndpoint/);
  assert.match(host, /readProviderMap\(command\.payload\?\.providers\)/);
  assert.match(host, /providerProfiles\[provider\]/);
  assert.match(host, /const providerKind = \(profile\?\.source \?\? provider\)\.toLowerCase\(\)/);
  assert.match(host, /retryTransientMediaJob/);
  assert.match(host, /IMAGE_GENERATION_REQUEST_TIMEOUT_MS/);
  assert.match(host, /requestTimeoutMs: executorId === "image_generate" \? IMAGE_GENERATION_REQUEST_TIMEOUT_MS : undefined/);
  assert.match(host, /const pptokenImageProvider = executorId === "image_generate"/);
  assert.match(host, /providerKind\.includes\("pptoken"\)/);
  assert.match(host, /providerHostname\.endsWith\("\.pptoken\.cc"\)/);
  assert.match(host, /imageTransport: pptokenImageProvider \? "curl"/);
  assert.match(host, /stage: "provider_request"/);
  assert.match(host, /stage: "result_download"/);
  assert.match(host, /const mediaDownloadFetch = providerKind\.includes\("minimax"\) && apiKey/);
  assert.match(host, /buildMediaCapabilityInput\(executorId, config, inputs\)/);
  assert.match(host, /const outputPort = executorId === "image_generate"/);
  assert.match(host, /\[outputPort\]: providerOutputs/);
  assert.match(host, /executorId === "ppt_generate" \? \{ ppt: artifacts \}/);
  assert.match(app, /providers: config\.providers/);
  assert.match(host, /executorId === "video_generate"/);
  assert.match(host, /executorId === "digital_human"/);
});

test("desktop host keeps voice cloning on the MiniMax media path", () => {
  const host = readFileSync(resolve(process.cwd(), "runtime/host.ts"), "utf8");
  assert.match(host, /voice_clone/);
  assert.match(host, /featureId: "voice-clone"/);
});

test("desktop voice synthesis loads MiniMax voices through the local host", () => {
  const host = readFileSync(resolve(process.cwd(), "runtime/host.ts"), "utf8");
  const app = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
  assert.match(host, /"media\.voices"/);
  assert.match(host, /listMiniMaxVoices/);
  assert.match(host, /voice_provider_unsupported/);
  assert.match(app, /"media\.voices"/);
  assert.match(app, /Reload voices/);
  assert.match(app, /voiceOptions\.slice\(0, 6\)/);
  assert.match(app, /activeFeature\.id === "voice-synthesis" && field\.id === "voiceId"/);
});
