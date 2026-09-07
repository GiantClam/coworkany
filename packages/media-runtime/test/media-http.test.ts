import test from "node:test";
import assert from "node:assert/strict";
import { createBailianVideoAdapter, createHttpMediaAdapter, downloadMediaOutputs, ProviderConfigurationRequiredError, type MediaProviderId } from "../src/index";
import { mkdtemp, open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("http media adapter submits and polls without cloud business services", async () => {
  const calls: string[] = [];
  const adapter = createHttpMediaAdapter({
    provider: "test" as MediaProviderId,
    baseUrl: "https://provider.invalid",
    apiKey: "secret",
    submitPath: "/images",
    queryPath: (id) => `/images/${id}`,
    fetchImpl: async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      return new Response(JSON.stringify(calls.length === 1 ? { id: "task-1", status: "running" } : { id: "task-1", status: "succeeded", data: [{ url: "https://files.invalid/image.png" }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const task = await adapter.execute({ provider: "test" as MediaProviderId, modelId: "image-model", input: { prompt: "hello" }, idempotencyKey: "run:node:1" }, { throwIfCancelled() {} });
  assert.equal(task.providerTaskId, "task-1");
  assert.equal(task.status, "running");
  const queried = await adapter.query!(task.providerTaskId, { throwIfCancelled() {} });
  assert.equal(queried.status, "succeeded");
  assert.deepEqual(calls.map((value) => value.split(" ")[0]), ["POST", "GET"]);
});

test("http media adapter supports OpenAI-compatible async media envelopes and preserves base URL paths", async () => {
  const calls: string[] = [];
  const adapter = createHttpMediaAdapter({
    provider: "pptoken" as MediaProviderId,
    baseUrl: "https://provider.invalid/v1",
    apiKey: "secret",
    submitPath: "/videos/generations",
    queryPath: (id) => `/videos/generations/${id}`,
    fetchImpl: async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (calls.length === 1) return new Response(JSON.stringify({ request_id: "request-1" }), { status: 200 });
      if (calls.length === 2) return new Response(JSON.stringify({ status: "pending", progress: 1 }), { status: 202 });
      return new Response(JSON.stringify({ model: "grok-imagine-video-1.5", status: "done", video_url: "https://files.invalid/video.mp4" }), { status: 200 });
    },
  });

  const submitted = await adapter.execute({ provider: "pptoken" as MediaProviderId, modelId: "grok-imagine-video-1.5", input: { prompt: "hello" } }, { throwIfCancelled() {} });
  assert.equal(submitted.providerTaskId, "request-1");
  assert.equal(submitted.status, "queued");
  const pending = await adapter.query!(submitted.providerTaskId, { throwIfCancelled() {} });
  assert.equal(pending.providerTaskId, "request-1");
  assert.equal(pending.status, "queued");
  const completed = await adapter.query!(submitted.providerTaskId, { throwIfCancelled() {} });
  assert.equal(completed.status, "succeeded");
  assert.deepEqual(completed.outputs, [{ url: "https://files.invalid/video.mp4" }]);
  assert.deepEqual(calls.map((value) => value.split(" ")[1]), [
    "https://provider.invalid/v1/videos/generations",
    "https://provider.invalid/v1/videos/generations/request-1",
    "https://provider.invalid/v1/videos/generations/request-1",
  ]);
});

test("http media adapter preserves provider rate-limit status", async () => {
  const adapter = createHttpMediaAdapter({
    provider: "test" as MediaProviderId,
    baseUrl: "https://provider.invalid",
    apiKey: "secret",
    submitPath: "/images",
    fetchImpl: async () => new Response(JSON.stringify({ error: { message: "rate limited" } }), { status: 429 }),
  });
  await assert.rejects(
    adapter.execute({ provider: "test" as MediaProviderId, modelId: "image-model", input: { prompt: "hello" } }, { throwIfCancelled() {} }),
    /media_provider_http_429/,
  );
});

test("http media adapter enforces an injected request timeout", async () => {
  const adapter = createHttpMediaAdapter({
    provider: "test" as MediaProviderId,
    baseUrl: "https://provider.invalid",
    apiKey: "secret",
    submitPath: "/images",
    requestTimeoutMs: 10,
    fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }),
  });

  await assert.rejects(
    adapter.execute({ provider: "test" as MediaProviderId, modelId: "image-model", input: { prompt: "slow image" } }, { throwIfCancelled() {} }),
    /media_provider_request_timeout/,
  );
});

test("http media adapter rejects invalid provider JSON responses", async () => {
  const adapter = createHttpMediaAdapter({
    provider: "test" as MediaProviderId,
    baseUrl: "https://provider.invalid",
    apiKey: "secret",
    submitPath: "/images",
    fetchImpl: async () => new Response("not-json", { status: 200 }),
  });
  await assert.rejects(
    adapter.execute({ provider: "test" as MediaProviderId, modelId: "image-model", input: { prompt: "hello" } }, { throwIfCancelled() {} }),
    /media_provider_invalid_response/,
  );
});

test("shared media adapters reject missing injected provider configuration before fetching", async () => {
  let requests = 0;
  const adapter = createHttpMediaAdapter({
    provider: "missing" as MediaProviderId,
    baseUrl: "",
    submitPath: "/images",
    fetchImpl: async () => { requests += 1; return new Response("{}", { status: 200 }); },
  });
  await assert.rejects(
    adapter.execute({ provider: "missing" as MediaProviderId, modelId: "image", input: {} }, { throwIfCancelled() {} }),
    (error: unknown) => error instanceof ProviderConfigurationRequiredError && error.code === "provider_configuration_required",
  );
  const direct = createBailianVideoAdapter({
    provider: "bailian" as MediaProviderId,
    baseUrl: "https://dashscope.aliyuncs.com",
    apiKey: "",
    fetchImpl: async () => { requests += 1; return new Response("{}", { status: 200 }); },
  });
  await assert.rejects(
    direct.execute({ provider: "bailian" as MediaProviderId, modelId: "video", input: { prompt: "test" } }, { throwIfCancelled() {} }),
    (error: unknown) => error instanceof ProviderConfigurationRequiredError && error.code === "provider_configuration_required",
  );
  assert.equal(requests, 0);
});

test("downloads media output to an atomic local artifact", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-media-"));
  const result = await downloadMediaOutputs({ providerTaskId: "task-1", status: "succeeded", outputs: [{ url: "https://files.invalid/clip.mp4" }] }, root, {
    fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } }),
    filenamePrefix: "clip",
  });
  assert.equal(result.length, 1);
  assert.equal((await readFile(join(root, result[0].relativePath))).length, 3);
  assert.equal(result[0].contentType, "video/mp4");
});

test("decodes provider data URLs without issuing a second download", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-media-data-url-"));
  let fetchCalls = 0;
  try {
    const png = Buffer.from("fixture-png").toString("base64");
    const result = await downloadMediaOutputs(
      { providerTaskId: "task-data-url", status: "succeeded", outputs: [{ url: `data:image/png;base64,${png}` }] },
      root,
      { fetchImpl: async () => { fetchCalls += 1; return new Response(null, { status: 500 }); } },
    );
    assert.equal(fetchCalls, 0);
    assert.equal(result.length, 1);
    assert.equal(result[0].contentType, "image/png");
    assert.equal(await readFile(join(root, result[0].relativePath), "utf8"), "fixture-png");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("uses the response MIME type when a provider URL has no media extension", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-media-mime-"));
  const result = await downloadMediaOutputs({ providerTaskId: "audio-task", status: "succeeded", outputs: [{ url: "https://files.invalid/retrieve_content?file_id=123" }] }, root, {
    fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "audio/mpeg" } }),
    filenamePrefix: "voice",
  });
  assert.match(result[0]?.relativePath ?? "", /\.mp3$/u);
});

test("detects PNG output when the provider returns an extensionless binary response", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-media-signature-"));
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
  const result = await downloadMediaOutputs({ providerTaskId: "image-task", status: "succeeded", outputs: [{ url: "https://files.invalid/generated" }] }, root, {
    fetchImpl: async () => new Response(png, { status: 200, headers: { "content-type": "application/octet-stream" } }),
    filenamePrefix: "image",
  });
  assert.match(result[0]?.relativePath ?? "", /\.png$/u);
  assert.equal(result[0]?.contentType, "image/png");
  assert.deepEqual([...await readFile(join(root, result[0]!.relativePath))], [...png]);
});

test("extracts a media file returned inside a provider TAR archive", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-media-tar-"));
  const media = Buffer.from([0x49, 0x44, 0x33, 1, 2, 3]);
  const header = Buffer.alloc(512);
  header.write("speech.mp3", 0, "utf8");
  header.write(media.length.toString(8).padStart(11, "0"), 124, "ascii");
  header[156] = 48;
  header.write("ustar", 257, "ascii");
  const archive = Buffer.concat([
    header as unknown as Uint8Array,
    media as unknown as Uint8Array,
    Buffer.alloc(512 - media.length) as unknown as Uint8Array,
    Buffer.alloc(1024) as unknown as Uint8Array,
  ]);
  const result = await downloadMediaOutputs({ providerTaskId: "audio-tar", status: "succeeded", outputs: [{ url: "https://files.invalid/retrieve_content" }] }, root, {
    fetchImpl: async () => new Response(new Uint8Array(archive), { status: 200, headers: { "content-type": "application/octet-stream" } }),
    filenamePrefix: "voice",
  });
  assert.match(result[0]?.relativePath ?? "", /\.mp3$/u);
  assert.equal(result[0]?.contentType, "audio/mpeg");
  assert.deepEqual(await readFile(join(root, result[0]!.relativePath)), media);
});

test("reuses an existing content-addressed media artifact on retry", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-media-retry-"));
  const task = { providerTaskId: "task-retry", status: "succeeded" as const, outputs: [{ url: "https://files.invalid/clip.mp4" }] };
  const fetchImpl: typeof fetch = async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } });
  const first = await downloadMediaOutputs(task, root, { fetchImpl, filenamePrefix: "clip" });
  const second = await downloadMediaOutputs(task, root, { fetchImpl, filenamePrefix: "clip" });
  assert.equal(second[0]?.relativePath, first[0]?.relativePath);
  assert.deepEqual(await readdir(root), [first[0]?.relativePath]);
});

test("overwrites the same-name media artifact when a retry refreshes it", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-media-overwrite-"));
  const task = { providerTaskId: "task-concurrent", status: "succeeded" as const, outputs: [{ url: "https://files.invalid/clip.mp4" }] };
  const fetchImpl: typeof fetch = async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "video/mp4" } });
  const first = await downloadMediaOutputs(task, root, { fetchImpl, filenamePrefix: "clip" });
  const relativePath = first[0]?.relativePath;
  assert.ok(relativePath);
  await writeFile(join(root, relativePath), "stale-output");
  const second = await downloadMediaOutputs(task, root, { fetchImpl, filenamePrefix: "clip" });
  assert.equal(second[0]?.relativePath, relativePath);
  assert.deepEqual(await readdir(root), [relativePath]);
  assert.deepEqual([...await readFile(join(root, relativePath))], [1, 2, 3]);
});

test("overwrites an existing content-addressed artifact while it is readable", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-media-lock-"));
  const task = { providerTaskId: "task-lock", status: "succeeded" as const, outputs: [{ url: "https://files.invalid/clip.mp4" }] };
  const fetchImpl: typeof fetch = async () => new Response(new Uint8Array([9, 8, 7]), { status: 200, headers: { "content-type": "video/mp4" } });
  const first = await downloadMediaOutputs(task, root, { fetchImpl, filenamePrefix: "clip" });
  const locked = await open(join(root, first[0]!.relativePath), "r");
  try {
    const second = await downloadMediaOutputs(task, root, { fetchImpl, filenamePrefix: "clip" });
    assert.equal(second[0]?.relativePath, first[0]?.relativePath);
    assert.deepEqual([...await readFile(join(root, first[0]!.relativePath))], [9, 8, 7]);
  } finally {
    await locked.close();
  }
});

test("rejects media output that exceeds the local artifact limit or MIME policy", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-media-limit-"));
  await assert.rejects(
    downloadMediaOutputs({ providerTaskId: "task-limit", status: "succeeded", outputs: [{ url: "https://files.invalid/clip.mp4" }] }, root, {
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "application/octet-stream", "content-length": "3" } }),
      maxBytes: 2,
      allowedContentTypes: ["video"],
    }),
    /media_download_(mime_rejected|too_large)/,
  );
});

test("streams chunked downloads and removes partial files on overflow", async () => {
  const root = await mkdtemp(join(tmpdir(), "coworkany-media-stream-"));
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4]));
      controller.close();
    },
  });
  await assert.rejects(
    downloadMediaOutputs({ providerTaskId: "task-stream", status: "succeeded", outputs: [{ url: "https://files.invalid/clip.mp4" }] }, root, {
      fetchImpl: async () => new Response(body, { status: 200, headers: { "content-type": "video/mp4" } }),
      maxBytes: 3,
      allowedContentTypes: ["video"],
    }),
    /media_download_too_large/,
  );
  assert.deepEqual(await readdir(root), []);
});
