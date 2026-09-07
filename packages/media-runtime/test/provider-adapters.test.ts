import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBailianImageAdapter, createBailianVideoAdapter, createMiniMaxAudioAdapter, createMiniMaxVideoAdapter, createOpenAICompatibleImageAdapter, createRunningHubAdapter, createRunningHubDigitalHumanAdapter, createRunningHubWorkflowAdapter, IMAGE_GENERATION_REQUEST_TIMEOUT_MS, listMiniMaxVoices, uploadRunningHubMedia, uploadRunningHubMediaAsset, type MediaProviderId } from "../src/index";

function cancellation() { return { throwIfCancelled() {} }; }

test("generic RunningHub workflow adapter builds nodeInfoList from bindings", async () => {
  let request: RequestInit | undefined;
  const adapter = createRunningHubWorkflowAdapter({
    provider: "runninghub" as MediaProviderId,
    baseUrl: "https://runninghub.example",
    apiKey: "secret",
    workflowId: "wf-user",
    bindings: [
      { inputId: "prompt", nodeId: "2", fieldName: "text", valueType: "literal" },
      { inputId: "images", nodeId: "1", fieldName: "image", valueType: "file_list" },
    ],
    fetchImpl: async (_input, init) => { request = init; return new Response(JSON.stringify({ code: 0, data: { taskId: "task-1" } }), { status: 200 }); },
  });
  const task = await adapter.execute({ provider: "runninghub" as MediaProviderId, modelId: "default", input: { prompt: "hello", images: ["one.png", "two.png"] }, idempotencyKey: "run-1" }, cancellation());
  assert.equal(task.providerTaskId, "task-1");
  const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
  assert.equal(body.workflowId, "wf-user");
  assert.deepEqual(body.nodeInfoList, [
    { nodeId: "2", fieldName: "text", fieldValue: "hello" },
    { nodeId: "1", fieldName: "image", fieldValue: "one.png" },
    { nodeId: "1", fieldName: "image", fieldValue: "two.png" },
  ]);
});

test("generic RunningHub workflow adapter applies migrated defaults", async () => {
  let request: RequestInit | undefined;
  const adapter = createRunningHubWorkflowAdapter({
    provider: "runninghub" as MediaProviderId,
    baseUrl: "https://runninghub.example",
    apiKey: "secret",
    workflowId: "legacy-enhance",
    bindings: [
      { inputId: "prompt", nodeId: "35", fieldName: "text", valueType: "literal", defaultValue: "enhance" },
      { inputId: "durationLimit", nodeId: "42", fieldName: "value", valueType: "literal", transform: "number", defaultValue: 10 },
    ],
    fetchImpl: async (_input, init) => { request = init; return new Response(JSON.stringify({ code: 0, data: { taskId: "task-legacy" } }), { status: 200 }); },
  });
  await adapter.execute({ provider: "runninghub" as MediaProviderId, modelId: "default", input: {} }, cancellation());
  const body = JSON.parse(String(request?.body)) as Record<string, unknown>;
  assert.deepEqual(body.nodeInfoList, [
    { nodeId: "35", fieldName: "text", fieldValue: "enhance" },
    { nodeId: "42", fieldName: "value", fieldValue: 10 },
  ]);
});

test("OpenAI-compatible image adapter sends a local image generation request", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const adapter = createOpenAICompatibleImageAdapter({ provider: "pptoken" as MediaProviderId, baseUrl: "https://api.example.test/v1", apiKey: "secret", fetchImpl: async (input, init) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({ data: [{ b64_json: "AQID" }], usage: { input_tokens: 4, output_tokens: 6, cost_usd: 0.12 } }), { status: 200 });
  } });
  const task = await adapter.execute({ provider: "pptoken" as MediaProviderId, modelId: "gpt-image-2", input: { prompt: "a paper airplane", size: "1024x1024", n: 7, quality: "high", background: "transparent", output_format: "webp", output_compression: 72, moderation: "low", response_format: "b64_json" }, idempotencyKey: "run:image:1" }, cancellation());
  assert.equal(task.status, "succeeded");
  assert.equal(task.outputs[0]?.b64_json, "AQID");
  assert.deepEqual(task.usage, { inputTokens: 4, outputTokens: 6, providerCost: 0.12 });
  assert.equal(request?.url, "https://api.example.test/v1/images/generations");
  const body = JSON.parse(String(request?.init?.body)) as Record<string, unknown>;
  assert.deepEqual(body, { model: "gpt-image-2", prompt: "a paper airplane", size: "1024x1024", n: 7, quality: "high", background: "transparent", output_format: "webp", output_compression: 72, moderation: "low", response_format: "b64_json", user: "run:image:1" });
});

test("OpenAI-compatible image adapter normalizes common image output aliases", async () => {
  const payloads = [
    { data: [{ image_url: "https://files.invalid/image-url.png" }] },
    { data: "https://files.invalid/image-data-string.png" },
    { output: { imageUrl: "https://files.invalid/image-url-camel.png" } },
    { images: [{ base64: "AQID" }] },
  ];
  for (const payload of payloads) {
    const adapter = createOpenAICompatibleImageAdapter({
      provider: "fixture" as MediaProviderId,
      baseUrl: "https://api.example.test/v1",
      apiKey: "secret",
      fetchImpl: async () => new Response(JSON.stringify(payload), { status: 200 }),
    });
    const task = await adapter.execute({ provider: "fixture" as MediaProviderId, modelId: "gpt-image-2", input: { prompt: "normalize image output" } }, cancellation());
    assert.equal(task.status, "succeeded");
    assert.equal(task.outputs.length, 1);
    assert.ok(task.outputs[0]?.url || task.outputs[0]?.base64);
  }
});

test("OpenAI-compatible image adapter omits compression for PNG output", async () => {
  let body: Record<string, unknown> | undefined;
  const adapter = createOpenAICompatibleImageAdapter({ provider: "fixture" as MediaProviderId, baseUrl: "https://api.example.test/v1", apiKey: "secret", fetchImpl: async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ data: [{ b64_json: "AQID" }] }), { status: 200 });
  } });
  await adapter.execute({ provider: "fixture" as MediaProviderId, modelId: "gpt-image-2", input: { prompt: "png image", output_format: "png", output_compression: 80 } }, cancellation());
  assert.equal("output_compression" in (body ?? {}), false);
});

test("OpenAI-compatible image adapter sends reference images through the edits endpoint", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const adapter = createOpenAICompatibleImageAdapter({ provider: "fixture" as MediaProviderId, baseUrl: "https://api.example.test/v1", apiKey: "secret", fetchImpl: async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === "https://cdn.example.test/reference.png") return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } });
    return new Response(JSON.stringify({ data: [{ b64_json: "AQID" }] }), { status: 200 });
  } });

  const task = await adapter.execute({ provider: "fixture" as MediaProviderId, modelId: "gpt-image-2", input: {
    prompt: "Re-style the reference image", size: "1024x1024", output_format: "png", referenceImageUrls: ["https://cdn.example.test/reference.png"],
  } }, cancellation());

  assert.equal(task.status, "succeeded");
  assert.equal(requests[1]?.url, "https://api.example.test/v1/images/edits");
  assert.equal(new Headers(requests[1]?.init?.headers).has("content-type"), false);
  const form = requests[1]?.init?.body as FormData;
  assert.equal(form.get("model"), "gpt-image-2");
  assert.equal(form.get("prompt"), "Re-style the reference image");
  assert.equal(form.get("output_format"), "png");
  assert.equal((form.get("image") as File).type, "image/png");
});

test("OpenAI-compatible image adapter reads a validated workflow-local reference", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-image-reference-"));
  try {
    const sourcePath = join(workspace, "reference.png");
    await writeFile(sourcePath, "PNG-fixture");
    let request: RequestInit | undefined;
    const adapter = createOpenAICompatibleImageAdapter({ provider: "fixture" as MediaProviderId, baseUrl: "https://api.example.test/v1", apiKey: "secret", workspacePath: workspace, fetchImpl: async (input, init) => {
      request = init;
      if (String(input).endsWith("/images/edits")) return new Response(JSON.stringify({ data: [{ b64_json: "AQID" }] }), { status: 200 });
      throw new Error(`unexpected_request:${String(input)}`);
    } });
    const task = await adapter.execute({ provider: "fixture" as MediaProviderId, modelId: "gpt-image-2", input: { prompt: "Edit the local image", referenceImageUrls: [sourcePath], workflowLocalAttachments: true } }, cancellation());
    assert.equal(task.status, "succeeded");
    const form = request?.body as FormData;
    assert.equal(form.get("model"), "gpt-image-2");
    assert.equal((form.get("image") as File).name, "reference.png");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("image generation requests use a five minute provider timeout", async () => {
  assert.equal(IMAGE_GENERATION_REQUEST_TIMEOUT_MS, 5 * 60 * 1000);
  const adapter = createOpenAICompatibleImageAdapter({
    provider: "pptoken" as MediaProviderId,
    baseUrl: "https://api.example.test/v1",
    apiKey: "secret",
    requestTimeoutMs: 10,
    fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }),
  });

  await assert.rejects(
    adapter.execute({ provider: "pptoken" as MediaProviderId, modelId: "gpt-image-2", input: { prompt: "slow image" } }, cancellation()),
    /media_provider_request_timeout/,
  );
});

test("user cancellation takes precedence over the image request timeout", async () => {
  const controller = new AbortController();
  const adapter = createOpenAICompatibleImageAdapter({
    provider: "pptoken" as MediaProviderId,
    baseUrl: "https://api.example.test/v1",
    apiKey: "secret",
    requestTimeoutMs: 1000,
    fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      setTimeout(() => controller.abort(), 5);
    }),
  });

  await assert.rejects(
    adapter.execute(
      { provider: "pptoken" as MediaProviderId, modelId: "gpt-image-2", input: { prompt: "cancelled image" } },
      { signal: controller.signal, throwIfCancelled() { if (controller.signal.aborted) throw new Error("media_cancelled"); } },
    ),
    /media_cancelled/,
  );
});

test("PPTOKEN image adapter can use the long-lived curl transport", async () => {
  let args: readonly string[] = [];
  const adapter = createOpenAICompatibleImageAdapter({
    provider: "pptoken" as MediaProviderId,
    baseUrl: "https://api.example.test/v1",
    apiKey: "secret",
    imageTransport: "curl",
    curlRunner: async (receivedArgs) => {
      args = receivedArgs;
      return { stdout: `${JSON.stringify({ data: [{ url: "https://files.invalid/image.png" }] })}\n__HTTP_STATUS__:200`, stderr: "", code: 0 };
    },
  });
  const task = await adapter.execute({ provider: "pptoken" as MediaProviderId, modelId: "gpt-image-2", input: { prompt: "curl image" }, idempotencyKey: "curl:image:1" }, cancellation());
  assert.equal(task.status, "succeeded");
  assert.equal(task.outputs[0]?.url, "https://files.invalid/image.png");
  assert.ok(args.includes("--max-time"));
  assert.ok(args.includes("300"));
  if (process.platform === "win32") assert.ok(args.includes("--ssl-no-revoke"));
  assert.ok(args.includes("Idempotency-Key: curl:image:1"));
});

test("PPTOKEN image edits use curl multipart transport for reference images", async () => {
  let args: readonly string[] = [];
  const adapter = createOpenAICompatibleImageAdapter({
    provider: "pptoken" as MediaProviderId,
    baseUrl: "https://api.example.test/v1",
    apiKey: "secret",
    imageTransport: "curl",
    fetchImpl: async () => { throw new Error("reference edit must not use fetch"); },
    curlRunner: async (receivedArgs) => {
      args = receivedArgs;
      return { stdout: `${JSON.stringify({ data: [{ url: "https://files.invalid/edited.png" }] })}\n__HTTP_STATUS__:200`, stderr: "", code: 0 };
    },
  });
  const task = await adapter.execute({
    provider: "pptoken" as MediaProviderId,
    modelId: "gpt-image-2",
    input: { prompt: "edit with a reference", referenceImageUrls: ["data:image/png;base64,AQID"] },
    idempotencyKey: "curl:image-edit:1",
  }, cancellation());
  assert.equal(task.status, "succeeded");
  assert.equal(task.outputs[0]?.url, "https://files.invalid/edited.png");
  assert.equal(args[args.indexOf("-X") + 1], "POST");
  assert.ok(args.includes("https://api.example.test/v1/images/edits"));
  assert.ok(args.includes("Idempotency-Key: curl:image-edit:1"));
  const imageForm = args.find((value) => value.startsWith("image=@"));
  assert.ok(imageForm);
  assert.equal(existsSync(imageForm!.slice("image=@".length).split(";", 1)[0]), false);
});

test("OpenAI-compatible image adapter finds media nested in provider result envelopes", async () => {
  const adapter = createOpenAICompatibleImageAdapter({
    provider: "image-main" as MediaProviderId,
    baseUrl: "https://api.example.test/v1",
    apiKey: "secret",
    fetchImpl: async () => new Response(JSON.stringify({
      data: { result: { images: [{ image: { url: "https://files.example.test/generated.png" } }] } },
    }), { status: 200 }),
  });

  const task = await adapter.execute({ provider: "image-main" as MediaProviderId, modelId: "gpt-image-2", input: { prompt: "nested output" } }, cancellation());

  assert.equal(task.status, "succeeded");
  assert.deepEqual(task.outputs, [{ url: "https://files.example.test/generated.png" }]);
});

test("image adapter preserves the configured model id when the provider returns 502", async () => {
  const requestBodies: Record<string, unknown>[] = [];
  const adapter = createOpenAICompatibleImageAdapter({
    provider: "pptoken" as MediaProviderId,
    baseUrl: "https://api.pptoken.cc/v1",
    apiKey: "secret",
    imageTransport: "curl",
    curlRunner: async (args) => {
      requestBodies.push(JSON.parse(String(args[args.indexOf("-d") + 1])) as Record<string, unknown>);
      return { stdout: `${JSON.stringify({ error: { message: "Upstream request failed" } })}\n__HTTP_STATUS__:502`, stderr: "", code: 0 };
    },
  });
  await assert.rejects(
    adapter.execute({ provider: "pptoken" as MediaProviderId, modelId: "gpt-image-2", input: { prompt: "strict model" } }, cancellation()),
    /media_provider_http_502:Upstream request failed/,
  );
  assert.deepEqual(requestBodies.map((body) => body.model), ["gpt-image-2"]);
});

test("Bailian image adapter submits and polls DashScope task results", async () => {
  const calls: string[] = [];
  const adapter = createBailianImageAdapter({ provider: "bailian" as MediaProviderId, baseUrl: "https://dashscope.aliyuncs.com", apiKey: "secret", fetchImpl: async (input, init) => {
    calls.push(String(input));
    return new Response(JSON.stringify(calls.length === 1 ? { output: { task_id: "image-task-1", task_status: "PENDING" } } : { output: { task_id: "image-task-1", task_status: "SUCCEEDED", results: [{ url: "https://files.invalid/image.png" }] } }), { status: 200 });
  } });
  const first = await adapter.execute({ provider: "bailian" as MediaProviderId, modelId: "wanx2.1-t2i-turbo", input: { prompt: "a blue kite", size: "1024*1024" }, idempotencyKey: "run:image:2" }, cancellation());
  const second = await adapter.query!(first.providerTaskId, cancellation());
  assert.equal(first.status, "queued");
  assert.equal(second.status, "succeeded");
  assert.equal(second.outputs[0]?.url, "https://files.invalid/image.png");
  assert.match(calls[0], /text2image\/image-synthesis$/);
});

test("Bailian Qwen image adapter sends multimodal and provider-specific parameters", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const adapter = createBailianImageAdapter({ provider: "bailian" as MediaProviderId, baseUrl: "https://dashscope.aliyuncs.com", apiKey: "secret", fetchImpl: async (_input, init) => {
    requestBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({ output: { choices: [{ message: { content: [{ image: "https://files.invalid/qwen.png" }] } }] } }), { status: 200 });
  } });
  const task = await adapter.execute({ provider: "bailian" as MediaProviderId, modelId: "qwen-image-3.0-pro", input: {
    prompt: "a blue kite", referenceImageUrls: ["https://files.invalid/reference.png"], size: "1536x1024", n: 2, negativePrompt: "blurry", promptExtend: "false", watermark: "true", seed: 42,
  } }, cancellation());
  const parameters = requestBody?.parameters as Record<string, unknown>;
  const messages = (requestBody?.input as Record<string, unknown>)?.messages as Array<Record<string, unknown>>;
  assert.equal(task.status, "succeeded");
  assert.equal(requestBody?.model, "qwen-image-3.0-pro");
  assert.equal(parameters.size, "1536*1024");
  assert.equal(parameters.n, 2);
  assert.equal(parameters.negative_prompt, "blurry");
  assert.equal(parameters.prompt_extend, false);
  assert.equal(parameters.watermark, true);
  assert.equal(parameters.seed, 42);
  assert.deepEqual(messages[0]?.content, [{ image: "https://files.invalid/reference.png" }, { text: "a blue kite" }]);
});

test("Bailian Qwen image edit rejects a request without a reference image", async () => {
  const adapter = createBailianImageAdapter({ provider: "bailian" as MediaProviderId, baseUrl: "https://dashscope.aliyuncs.com", apiKey: "secret", fetchImpl: async () => new Response("{}", { status: 200 }) });
  await assert.rejects(() => adapter.execute({ provider: "bailian" as MediaProviderId, modelId: "qwen-image-3.0-pro-edit", input: { prompt: "edit" } }, cancellation()), /image_reference_required/);
});

test("Bailian image adapter converts a local reference to a Base64 Data URL", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-bailian-image-reference-"));
  try {
    const sourcePath = join(workspace, "reference.png");
    await writeFile(sourcePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    let requestBody: Record<string, unknown> | undefined;
    const adapter = createBailianImageAdapter({ provider: "bailian" as MediaProviderId, baseUrl: "https://dashscope.aliyuncs.com", apiKey: "secret", workspacePath: workspace, fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ output: { choices: [{ message: { content: [{ image: "https://files.invalid/output.png" }] } }] } }), { status: 200 });
    } });
    await adapter.execute({ provider: "bailian" as MediaProviderId, modelId: "qwen-image-3.0-pro", input: { prompt: "edit", referenceImageUrls: [sourcePath], workflowLocalAttachments: true } }, cancellation());
    const messages = (requestBody?.input as Record<string, unknown>)?.messages as Array<Record<string, unknown>>;
    const content = messages[0]?.content as Array<Record<string, unknown>>;
    assert.match(String(content[0]?.image), /^data:image\/png;base64,/u);
    assert.equal(String(content[0]?.image).includes(sourcePath), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("Bailian video adapter sends direct DashScope async request and polls task", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const adapter = createBailianVideoAdapter({ provider: "bailian" as MediaProviderId, baseUrl: "https://dashscope.aliyuncs.com", apiKey: "secret", fetchImpl: async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(calls.length === 1 ? { output: { task_id: "task-1", task_status: "PENDING" } } : { output: { task_id: "task-1", task_status: "SUCCEEDED", video_url: "https://files.invalid/video.mp4" } }), { status: 200 });
  } });
  const first = await adapter.execute({ provider: "bailian" as MediaProviderId, modelId: "wanx-video", input: { prompt: "中文广告", duration: 6 }, idempotencyKey: "run:node:1" }, cancellation());
  const second = await adapter.query!(first.providerTaskId, cancellation());
  assert.equal(first.status, "queued");
  assert.equal(second.status, "succeeded");
  assert.match(calls[0].url, /video-synthesis$/);
  assert.equal(new Headers(calls[0].init?.headers).get("X-DashScope-Async"), "enable");
  assert.equal((JSON.parse(String(calls[0].init?.body)) as { input: { prompt: string } }).input.prompt, "中文广告");
});

test("Bailian video adapter preserves reference/edit media parameters", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const adapter = createBailianVideoAdapter({ provider: "bailian" as MediaProviderId, baseUrl: "https://dashscope.aliyuncs.com", apiKey: "secret", fetchImpl: async (_input, init) => {
    requestBody = JSON.parse(String(init?.body || "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({ output: { task_id: "task-edit", task_status: "PENDING" } }), { status: 200 });
  } });
  await adapter.execute({ provider: "bailian" as MediaProviderId, modelId: "happyhorse-1.0-video-edit", input: {
    featureId: "video-edit", prompt: "replace the background", sourceVideoUrl: "https://files.invalid/source.mp4", referenceImageUrls: ["https://files.invalid/ref.png"], resolution: "720P", audioSetting: "origin", watermark: "false", seed: 7,
  } }, cancellation());
  const parameters = requestBody?.parameters as Record<string, unknown>;
  const input = requestBody?.input as Record<string, unknown>;
  assert.equal(parameters.resolution, "720P");
  assert.equal(parameters.audio_setting, "origin");
  assert.equal(parameters.watermark, false);
  assert.equal(parameters.seed, 7);
  assert.deepEqual(input.media, [{ type: "video", url: "https://files.invalid/source.mp4" }, { type: "reference_image", url: "https://files.invalid/ref.png" }]);
});

test("Bailian video adapter converts local first and reference frames to Data URLs", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-bailian-video-reference-"));
  try {
    const firstPath = join(workspace, "first.png");
    const referencePath = join(workspace, "reference.png");
    await writeFile(firstPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(referencePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    let requestBody: Record<string, unknown> | undefined;
    const adapter = createBailianVideoAdapter({ provider: "bailian" as MediaProviderId, baseUrl: "https://dashscope.aliyuncs.com", apiKey: "secret", workspacePath: workspace, fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ output: { task_id: "task-local", task_status: "PENDING" } }), { status: 200 });
    } });
    await adapter.execute({ provider: "bailian" as MediaProviderId, modelId: "wan3.0-video-prime", input: { prompt: "animate", featureId: "reference-to-video", firstFrameUrl: firstPath, referenceImageUrls: [referencePath], workflowLocalAttachments: true } }, cancellation());
    const input = requestBody?.input as Record<string, unknown>;
    const media = input.media as Array<Record<string, string>>;
    assert.equal(media[0]?.type, "first_frame");
    assert.match(media[0]?.url ?? "", /^data:image\/png;base64,/u);
    assert.equal(media[1]?.type, "reference_image");
    assert.match(media[1]?.url ?? "", /^data:image\/png;base64,/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("Bailian Wan 3 adapter uploads local video and audio references before synthesis", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-bailian-video-media-"));
  try {
    const sourcePath = join(workspace, "source.mp4");
    const referencePath = join(workspace, "reference.mp4");
    const audioPath = join(workspace, "reference.mp3");
    await writeFile(sourcePath, Buffer.from("source-video"));
    await writeFile(referencePath, Buffer.from("reference-video"));
    await writeFile(audioPath, Buffer.from("reference-audio"));
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const adapter = createBailianVideoAdapter({ provider: "bailian" as MediaProviderId, baseUrl: "https://dashscope.aliyuncs.com", apiKey: "secret", workspacePath: workspace, fetchImpl: async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("/uploads")) return new Response(JSON.stringify({ data: { policy: "policy", signature: "signature", upload_dir: "dashscope-instant/test", upload_host: "https://upload.invalid", oss_access_key_id: "access", x_oss_object_acl: "private", x_oss_forbid_overwrite: "true" } }), { status: 200 });
      if (url === "https://upload.invalid") return new Response("", { status: 200 });
      return new Response(JSON.stringify({ output: { task_id: "task-media", task_status: "PENDING" } }), { status: 200 });
    } });
    await adapter.execute({ provider: "bailian" as MediaProviderId, modelId: "wan3.0-video-prime", input: {
      featureId: "reference-to-video", prompt: "animate", sourceVideoUrl: sourcePath, referenceVideoUrls: [referencePath], referenceAudioUrls: [audioPath], workflowLocalAttachments: true,
    } }, cancellation());
    const synthesis = requests.find((request) => request.url.includes("video-synthesis"));
    assert.ok(synthesis);
    const body = JSON.parse(String(synthesis.init?.body)) as { input: { media: Array<{ type: string; url: string }> } };
    assert.deepEqual(body.input.media.map((item) => item.type), ["reference_video", "reference_audio"]);
    assert.equal(body.input.media.every((item) => item.url.startsWith("oss://")), true);
    assert.equal(new Headers(synthesis.init?.headers).get("X-DashScope-OssResourceResolve"), "enable");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("Bailian Wan 3 rejects frame media combined with reference media", async () => {
  const adapter = createBailianVideoAdapter({ provider: "bailian" as MediaProviderId, baseUrl: "https://dashscope.aliyuncs.com", apiKey: "secret", fetchImpl: async () => {
    throw new Error("synthesis should not be called");
  } });
  await assert.rejects(
    adapter.execute({ provider: "bailian" as MediaProviderId, modelId: "wan3.0-video-prime", input: {
      featureId: "reference-to-video", prompt: "animate", firstFrameUrl: "https://files.invalid/frame.png", referenceImageUrls: ["https://files.invalid/ref.png"],
    } }, cancellation()),
    /provider_media_combination_unsupported:wan3_frames_with_references/,
  );
});

test("MiniMax video adapter maps file ids to direct local-download URLs", async () => {
  const adapter = createMiniMaxVideoAdapter({ provider: "minimax" as MediaProviderId, baseUrl: "https://api.minimax.io", apiKey: "secret", fetchImpl: async () => new Response(JSON.stringify({ task_id: "task-2", status: "Success", file_id: "file-2" }), { status: 200 }) });
  const task = await adapter.execute({ provider: "minimax" as MediaProviderId, modelId: "MiniMax-Hailuo-2.3", input: { prompt: "demo" } }, cancellation());
  assert.equal(task.status, "succeeded");
  assert.match(String(task.outputs[0]?.url), /files\/retrieve\?file_id=file-2/);
});

test("MiniMax video adapter converts local first and last frames to Data URLs", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-minimax-video-reference-"));
  try {
    const firstPath = join(workspace, "first.png");
    const lastPath = join(workspace, "last.png");
    await writeFile(firstPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await writeFile(lastPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    let requestBody: Record<string, unknown> | undefined;
    const adapter = createMiniMaxVideoAdapter({ provider: "minimax" as MediaProviderId, baseUrl: "https://api.minimax.io/v1", apiKey: "secret", workspacePath: workspace, fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ task_id: "task-local", status: "Success", file_id: "file-local" }), { status: 200 });
    } });
    await adapter.execute({ provider: "minimax" as MediaProviderId, modelId: "MiniMax-Hailuo-2.3", input: { prompt: "animate", firstFrameUrl: firstPath, lastFrameUrl: lastPath, workflowLocalAttachments: true } }, cancellation());
    assert.match(String(requestBody?.first_frame_image), /^data:image\/png;base64,/u);
    assert.match(String(requestBody?.last_frame_image), /^data:image\/png;base64,/u);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("MiniMax music adapter keeps synchronous base64 output local", async () => {
  const adapter = createMiniMaxAudioAdapter({ provider: "minimax" as MediaProviderId, baseUrl: "https://api.minimax.io", apiKey: "secret", fetchImpl: async () => new Response(JSON.stringify({ data: { audio: "AQID" } }), { status: 200 }) });
  const task = await adapter.execute({ provider: "minimax" as MediaProviderId, modelId: "music-1", input: { kind: "music", prompt: "轻快" } }, cancellation());
  assert.equal(task.status, "succeeded");
  assert.equal(task.outputs[0]?.b64_json, "AQID");
});

test("MiniMax voice-clone capability calls the clone endpoint and preserves the preview", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const adapter = createMiniMaxAudioAdapter({ provider: "minimax" as MediaProviderId, baseUrl: "https://api.minimax.io/v1", apiKey: "secret", fetchImpl: async (input, init) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({ demo_audio: "https://files.invalid/voice-preview.mp3", extra_info: { voice_id: "voice-1" } }), { status: 200 });
  } });
  const task = await adapter.execute({ provider: "minimax" as MediaProviderId, modelId: "speech-2.8-turbo", input: { featureId: "voice-clone", sourceFileId: "42", voiceId: "voice-1", previewText: "你好" } }, cancellation());
  assert.equal(task.status, "succeeded");
  assert.equal(task.outputs[0]?.url, "https://files.invalid/voice-preview.mp3");
  assert.equal(request?.url, "https://api.minimax.io/v1/voice_clone");
  const body = JSON.parse(String(request?.init?.body)) as Record<string, unknown>;
  assert.equal(body.file_id, 42);
  assert.equal(body.voice_id, "voice-1");
  assert.equal(body.text, "你好");
});

test("MiniMax voice-synthesis capability creates and polls an async speech task", async () => {
  let calls = 0;
  const adapter = createMiniMaxAudioAdapter({ provider: "minimax" as MediaProviderId, baseUrl: "https://api.minimax.io/v1", apiKey: "secret", fetchImpl: async (input) => {
    calls += 1;
    return new Response(JSON.stringify(calls === 1 ? { task_id: "speech-task-1", status: "Pending" } : { task_id: "speech-task-1", status: "Success", file_id: "99" }), { status: 200 });
  } });
  const first = await adapter.execute({ provider: "minimax" as MediaProviderId, modelId: "speech-2.8-hd", input: { featureId: "voice-synthesis", prompt: "Hello", voiceId: "English_Trustworth_Man" } }, cancellation());
  const second = await adapter.query!(first.providerTaskId, cancellation());
  assert.equal(first.status, "queued");
  assert.equal(second.status, "succeeded");
  assert.match(String(second.outputs[0]?.url), /files\/retrieve_content\?file_id=99/);
});

test("MiniMax voice library maps provider categories without returning raw credentials", async () => {
  let request: { url: string; init?: RequestInit } | undefined;
  const voices = await listMiniMaxVoices({ provider: "minimax" as MediaProviderId, baseUrl: "https://api.minimax.io/v1", apiKey: "secret", fetchImpl: async (input, init) => {
    request = { url: String(input), init };
    return new Response(JSON.stringify({
      system_voice: [{ voice_id: "English_Trustworth_Man", voice_name: "Trustworthy Man", description: ["Warm English narration"], created_time: "2026-01-01" }],
      voice_cloning: [{ voice_id: "clone-1", description: ["Brand voice"] }],
      voice_generation: [{ voice_id: "generated-1", voice_name: "Generated voice" }],
    }), { status: 200 });
  } });
  assert.equal(request?.url, "https://api.minimax.io/v1/get_voice");
  assert.deepEqual(JSON.parse(String(request?.init?.body)), { voice_type: "all" });
  assert.deepEqual(voices, [
    { voiceId: "English_Trustworth_Man", voiceName: "Trustworthy Man", category: "system", description: ["Warm English narration"], createdTime: "2026-01-01" },
    { voiceId: "clone-1", voiceName: "clone-1", category: "voice_cloning", description: ["Brand voice"], createdTime: null },
    { voiceId: "generated-1", voiceName: "Generated voice", category: "voice_generation", description: [], createdTime: null },
  ]);
});

test("MiniMax speech acknowledgement without a status remains queued for polling", async () => {
  const adapter = createMiniMaxAudioAdapter({ provider: "minimax" as MediaProviderId, baseUrl: "https://api.minimax.io/v1", apiKey: "secret", fetchImpl: async () => new Response(JSON.stringify({ task_id: "speech-task-statusless" }), { status: 200 }) });
  const task = await adapter.execute({ provider: "minimax" as MediaProviderId, modelId: "speech-2.8-hd", input: { kind: "speech", text: "Hello" } }, cancellation());
  assert.equal(task.status, "queued");
  assert.equal(task.providerTaskId, "speech-task-statusless");
});

test("MiniMax audio adapter preserves numeric provider task and file IDs", async () => {
  let calls = 0;
  const adapter = createMiniMaxAudioAdapter({ provider: "minimax" as MediaProviderId, baseUrl: "https://api.minimax.io/v1", apiKey: "secret", fetchImpl: async () => {
    calls += 1;
    return new Response(JSON.stringify(calls === 1 ? { task_id: 123 } : { task_id: 123, status: "Success", file_id: 456 }), { status: 200 });
  } });
  const submitted = await adapter.execute({ provider: "minimax" as MediaProviderId, modelId: "speech-2.8-hd", input: { kind: "speech", text: "Hello" } }, cancellation());
  const completed = await adapter.query!(submitted.providerTaskId, cancellation());
  assert.equal(submitted.providerTaskId, "123");
  assert.match(String(completed.outputs[0]?.url), /file_id=456/);
});

test("MiniMax voice clone uploads an in-workspace reference without base64 IPC", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-voice-clone-"));
  try {
    await writeFile(join(workspace, "reference.wav"), "RIFF-fixture");
    const urls: string[] = [];
    const adapter = createMiniMaxAudioAdapter({ provider: "minimax" as MediaProviderId, baseUrl: "https://api.minimax.io/v1", apiKey: "secret", workspacePath: workspace, fetchImpl: async (input, init) => {
      urls.push(String(input));
      if (urls.length === 1) {
        assert.equal(init?.body instanceof FormData, true);
        const form = init?.body as FormData;
        assert.equal(form.get("purpose"), "voice_clone");
        const file = form.get("file");
        assert.equal(file instanceof Blob, true);
        assert.equal((file as File).name, "reference.wav");
        return new Response(JSON.stringify({ file: { file_id: 77 } }), { status: 200 });
      }
      return new Response(JSON.stringify({ demo_audio: "https://files.invalid/preview.mp3" }), { status: 200 });
    } });
    const task = await adapter.execute({ provider: "minimax" as MediaProviderId, modelId: "speech-2.8-turbo", input: { featureId: "voice-clone", localAttachments: ["reference.wav"], previewText: "Hello" } }, cancellation());
    assert.equal(task.status, "succeeded");
    assert.equal(task.outputs[0]?.url, "https://files.invalid/preview.mp3");
    assert.deepEqual(urls, ["https://api.minimax.io/v1/files/upload", "https://api.minimax.io/v1/voice_clone"]);
    await assert.rejects(
      adapter.execute({ provider: "minimax" as MediaProviderId, modelId: "speech-2.8-turbo", input: { featureId: "voice-clone", localAttachments: ["../outside.wav"] } }, cancellation()),
      /voice_clone_source_file_unsafe/,
    );
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("MiniMax voice clone accepts an absolute path only for a validated workflow-local attachment", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-workflow-voice-clone-"));
  try {
    const sourcePath = join(workspace, "reference.wav");
    await writeFile(sourcePath, "RIFF-fixture");
    let calls = 0;
    const adapter = createMiniMaxAudioAdapter({ provider: "minimax" as MediaProviderId, baseUrl: "https://api.minimax.io/v1", apiKey: "secret", workspacePath: workspace, fetchImpl: async (_input, init) => {
      calls += 1;
      if (calls === 1) {
        assert.equal(init?.body instanceof FormData, true);
        return new Response(JSON.stringify({ file: { file_id: 78 } }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    } });
    await adapter.execute({ provider: "minimax" as MediaProviderId, modelId: "speech-2.8-turbo", input: { featureId: "voice-clone", localAttachments: [sourcePath], workflowLocalAttachments: true } }, cancellation());
    assert.equal(calls, 2);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("RunningHub adapter submits and queries task results without SaaS transport", async () => {
  let call = 0;
  const adapter = createRunningHubAdapter({ provider: "runninghub" as MediaProviderId, baseUrl: "https://www.runninghub.cn", apiKey: "secret", submitPath: "/openapi/v2/rhart-video/demo", fetchImpl: async (_input, init) => {
    call += 1;
    return new Response(JSON.stringify(call === 1 ? { data: { taskId: "rh-1", status: "QUEUED" } } : { data: { taskId: "rh-1", status: "SUCCESS", results: [{ url: "https://files.invalid/rh.mp4" }] } }), { status: 200 });
  } });
  const submitted = await adapter.execute({ provider: "runninghub" as MediaProviderId, modelId: "seedance", input: { prompt: "demo" } }, cancellation());
  const finished = await adapter.query!(submitted.providerTaskId, cancellation());
  assert.equal(submitted.status, "queued");
  assert.equal(finished.status, "succeeded");
  assert.equal(finished.outputs[0]?.url, "https://files.invalid/rh.mp4");
});

test("RunningHub submission without output URLs stays queued even with a success acknowledgement", async () => {
  const adapter = createRunningHubAdapter({ provider: "runninghub" as MediaProviderId, baseUrl: "https://www.runninghub.cn", apiKey: "secret", submitPath: "/openapi/v2/minimax/hailuo", fetchImpl: async () => new Response(JSON.stringify({ data: { taskId: "rh-pending", status: "SUCCESS" } }), { status: 200 }) });
  const task = await adapter.execute({ provider: "runninghub" as MediaProviderId, modelId: "MiniMax-Hailuo-H3", input: { prompt: "demo" } }, cancellation());
  assert.equal(task.status, "queued");
  assert.equal(task.providerTaskId, "rh-pending");
});

test("RunningHub accepts taskStatus and fileUrl result aliases from H3 workflows", async () => {
  let call = 0;
  const adapter = createRunningHubAdapter({ provider: "runninghub" as MediaProviderId, baseUrl: "https://www.runninghub.cn", apiKey: "secret", submitPath: "/openapi/v2/minimax/hailuo-h3/multimodal-to-video", fetchImpl: async () => {
    call += 1;
    return new Response(JSON.stringify(call === 1 ? { data: { taskId: "h3-1", taskStatus: "RUNNING" } } : { data: { taskId: "h3-1", taskStatus: "SUCCESS", results: [{ fileUrl: "https://files.invalid/h3.mp4" }] } }), { status: 200 });
  } });
  const submitted = await adapter.execute({ provider: "runninghub" as MediaProviderId, modelId: "MiniMax-Hailuo-H3", input: { prompt: "demo" } }, cancellation());
  const finished = await adapter.query!(submitted.providerTaskId, cancellation());
  assert.equal(submitted.providerTaskId, "h3-1");
  assert.equal(submitted.status, "running");
  assert.equal(finished.status, "succeeded");
  assert.equal(finished.outputs[0]?.url, "https://files.invalid/h3.mp4");
});

test("RunningHub H3 adapter maps canonical media roles to the documented multimodal fields", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const adapter = createRunningHubAdapter({ provider: "runninghub" as MediaProviderId, baseUrl: "https://www.runninghub.cn", apiKey: "secret", submitPath: "/openapi/v2/minimax/hailuo-h3/multimodal-to-video", fetchImpl: async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ data: { taskId: "h3-media", status: "RUNNING" } }), { status: 200 });
  } });
  await adapter.execute({ provider: "runninghub" as MediaProviderId, modelId: "MiniMax-Hailuo-H3", input: {
    prompt: "use references", referenceImageUrls: ["https://files.invalid/ref.png"], referenceVideoUrls: ["https://files.invalid/ref.mp4"], referenceAudioUrls: ["https://files.invalid/ref.mp3"],
  } }, cancellation());
  assert.deepEqual(requestBody, {
    prompt: "use references",
    imageUrls: ["https://files.invalid/ref.png"],
    videoUrls: ["https://files.invalid/ref.mp4"],
    audioUrls: ["https://files.invalid/ref.mp3"],
  });
});

test("RunningHub digital-human adapter submits the configured workflow and polls its task", async () => {
  let call = 0;
  const adapter = createRunningHubDigitalHumanAdapter({ provider: "runninghub" as MediaProviderId, baseUrl: "https://www.runninghub.cn", apiKey: "secret", workflowId: "workflow-1", fetchImpl: async (_input, init) => {
    call += 1;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if (call === 1) {
      assert.equal(body.workflowId, "workflow-1");
      assert.equal(Array.isArray(body.nodeInfoList), true);
      return new Response(JSON.stringify({ data: { taskId: "human-1", taskStatus: "RUNNING" } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { taskId: "human-1", taskStatus: "SUCCESS", results: [{ videoUrl: "https://files.invalid/human.mp4" }] } }), { status: 200 });
  } });
  const submitted = await adapter.execute({ provider: "runninghub" as MediaProviderId, modelId: "workflow", input: { avatarImageUrl: "https://files.invalid/avatar.png", script: "hello" } }, cancellation());
  const finished = await adapter.query!(submitted.providerTaskId, cancellation());
  assert.equal(submitted.providerTaskId, "human-1");
  assert.equal(finished.outputs[0]?.url, "https://files.invalid/human.mp4");
});

test("RunningHub digital-human adapter reports account-owned workflow access failures", async () => {
  const forbidden = createRunningHubDigitalHumanAdapter({ provider: "runninghub" as MediaProviderId, baseUrl: "https://www.runninghub.cn", apiKey: "user-key", workflowId: "another-account-workflow", fetchImpl: async () => new Response(JSON.stringify({ message: "workflow not found" }), { status: 404 }) });
  await assert.rejects(() => forbidden.execute({ provider: "runninghub" as MediaProviderId, modelId: "workflow", input: { avatarImageUrl: "https://files.invalid/avatar.png", script: "hello" } }, cancellation()), /runninghub_workflow_not_accessible/);

  const businessError = createRunningHubDigitalHumanAdapter({ provider: "runninghub" as MediaProviderId, baseUrl: "https://www.runninghub.cn", apiKey: "user-key", workflowId: "another-account-workflow", fetchImpl: async () => new Response(JSON.stringify({ code: 404, message: "workflow unavailable" }), { status: 200 }) });
  await assert.rejects(() => businessError.execute({ provider: "runninghub" as MediaProviderId, modelId: "workflow", input: { avatarImageUrl: "https://files.invalid/avatar.png", script: "hello" } }, cancellation()), /runninghub_workflow_not_accessible/);
});

test("RunningHub workflow upload returns the provider file name used by LoadAudio and LoadImage", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-runninghub-upload-"));
  try {
    const sourcePath = join(workspace, "speech.mp3");
    await writeFile(sourcePath, "ID3-fixture");
    const uploaded = await uploadRunningHubMedia({
      provider: "runninghub" as MediaProviderId,
      baseUrl: "https://www.runninghub.cn",
      apiKey: "secret",
      fetchImpl: async (_input, init) => {
        assert.equal(init?.body instanceof FormData, true);
        return new Response(JSON.stringify({ code: 0, data: { fileName: "provider-speech.mp3", download_url: "https://files.invalid/provider-speech.mp3" } }), { status: 200 });
      },
    }, sourcePath, cancellation());
    assert.equal(uploaded, "provider-speech.mp3");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("RunningHub workflow upload preserves a URL fallback for URL-based loader nodes", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "coworkany-runninghub-upload-asset-"));
  try {
    const sourcePath = join(workspace, "speech.mp3");
    await writeFile(sourcePath, "ID3-fixture");
    const uploaded = await uploadRunningHubMediaAsset({
      provider: "runninghub" as MediaProviderId,
      baseUrl: "https://www.runninghub.cn",
      apiKey: "secret",
      fetchImpl: async () => new Response(JSON.stringify({ code: 0, data: { fileName: "provider-speech.mp3", download_url: "https://files.invalid/provider-speech.mp3" } }), { status: 200 }),
    }, sourcePath, cancellation());
    assert.deepEqual(uploaded, { fileName: "provider-speech.mp3", downloadUrl: "https://files.invalid/provider-speech.mp3" });
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("RunningHub task preserves bounded provider failure diagnostics", async () => {
  const adapter = createRunningHubAdapter({ provider: "runninghub" as MediaProviderId, baseUrl: "https://www.runninghub.cn", apiKey: "secret", submitPath: "/workflow", queryPath: "/query", fetchImpl: async () => new Response(JSON.stringify({ data: { taskId: "failed-1", status: "FAILED", errorMessage: "工作流运行失败" }, failedReason: { node_name: "LoadAudioFromUrl", exception_message: "InvalidDataError: invalid data" } }), { status: 200 }) });
  const task = await adapter.execute({ provider: "runninghub" as MediaProviderId, modelId: "workflow", input: {} }, cancellation());
  assert.equal(task.status, "failed");
  assert.equal(task.error, "LoadAudioFromUrl: InvalidDataError: invalid data");
});
