import test from "node:test";
import assert from "node:assert/strict";
import { createCheapBuddyMediaFetch, createCheapBuddyVideoAdapter, runMediaJob, type MediaProviderId } from "../src/index";

const provider = "cheapbuddy" as MediaProviderId;
const baseUrl = "https://api.cheapbuddy.cc/v1";
const cancellation = { throwIfCancelled() {} };

test("Relay video submission forwards idempotency header and polls protected content", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const adapter = createCheapBuddyVideoAdapter({
    provider, baseUrl, apiKey: "fixture-key", fetchImpl: async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(calls.length === 1 ? { id: "video-1", status: "queued" } : calls.length === 2 ? { id: "video-1", status: "in_progress" } : { id: "video-1", status: "completed" }), { status: 200 });
    },
  });
  const queued = await adapter.execute({ provider, modelId: "MiniMax-H3", input: { prompt: "a tree", duration: 6, ignored: "internal-state" }, idempotencyKey: "run:node:attempt" }, cancellation);
  assert.equal(queued.status, "queued");
  assert.equal(calls[0]?.url, `${baseUrl}/videos`);
  assert.equal(new Headers(calls[0]?.init?.headers).get("Idempotency-Key"), "run:node:attempt");
  assert.equal(new Headers(calls[0]?.init?.headers).get("authorization"), "Bearer fixture-key");
  assert.deepEqual(JSON.parse(String(calls[0]?.init?.body)), { model: "MiniMax-H3", prompt: "a tree", seconds: "6" });
  assert.equal((await adapter.query!(queued.providerTaskId, cancellation)).status, "running");
  const complete = await adapter.query!(queued.providerTaskId, cancellation);
  assert.equal(complete.status, "succeeded");
  assert.deepEqual(complete.outputs, [{ url: `${baseUrl}/videos/video-1/content` }]);
  assert.equal(JSON.stringify(complete).includes("fixture-key"), false);
  assert.equal(calls.length, 3);
});

test("Relay preserves terminal states and retains acknowledged IDs for unknown status polling", async () => {
  for (const [status, expected] of [["failed", "failed"], ["cancelled", "cancelled"]] as const) {
    const adapter = createCheapBuddyVideoAdapter({ provider, baseUrl, apiKey: "fixture", fetchImpl: async () => new Response(JSON.stringify({ data: { id: "id", status, error: { message: "upstream task failed" } } }), { status: 200 }) });
    const task = await adapter.query!("id", cancellation);
    assert.equal(task.status, expected);
    assert.deepEqual(task.outputs, []);
    if (status === "failed") assert.equal(task.error, "upstream task failed");
  }
  const unknown = createCheapBuddyVideoAdapter({ provider, baseUrl, apiKey: "fixture", fetchImpl: async () => new Response(JSON.stringify({ id: "id", status: "unknown" }), { status: 200 }) });
  const task = await unknown.query!("id", cancellation);
  assert.equal(task.status, "running");
  assert.equal(task.providerTaskId, "id");
  assert.deepEqual(task.outputs, []);
  const missing = createCheapBuddyVideoAdapter({ provider, baseUrl, apiKey: "fixture", fetchImpl: async () => new Response("{}", { status: 200 }) });
  await assert.rejects(missing.execute({ provider, modelId: "MiniMax-H3", input: { prompt: "a tree" } }, cancellation), /cheapbuddy_video_submission_ambiguous/);
});

test("an acknowledged video task without status is persisted then polled without another submission", async () => {
  const calls: string[] = [];
  const persisted: string[] = [];
  const adapter = createCheapBuddyVideoAdapter({ provider, baseUrl, apiKey: "fixture", fetchImpl: async (input, init) => {
    calls.push(`${init?.method} ${input}`);
    return new Response(JSON.stringify(calls.length === 1 ? { id: "known-id" } : { id: "known-id", status: "completed" }), { status: 200 });
  } });
  const task = await runMediaJob(adapter, { provider, modelId: "MiniMax-H3", input: { prompt: "a tree" } }, cancellation, { pollIntervalMs: 10, onSubmitted: (submitted) => { persisted.push(submitted.providerTaskId); } });
  assert.deepEqual(persisted, ["known-id"]);
  assert.deepEqual(calls, [`POST ${baseUrl}/videos`, `GET ${baseUrl}/videos/known-id`]);
  assert.equal(task.status, "succeeded");
});

test("Relay task IDs are encoded and unsupported video inputs fail before chargeable submission", async () => {
  let count = 0;
  let url = "";
  const adapter = createCheapBuddyVideoAdapter({ provider, baseUrl, apiKey: "fixture", fetchImpl: async (input) => { count += 1; url = String(input); return new Response(JSON.stringify({ status: "completed" }), { status: 200 }); } });
  await adapter.query!("id/unsafe", cancellation);
  assert.equal(url, `${baseUrl}/videos/id%2Funsafe`);
  await assert.rejects(adapter.execute({ provider, modelId: "MiniMax-H3", input: { prompt: "reference", referenceVideoUrls: ["https://files.test/ref.mp4"] } }, cancellation), /provider_media_role_unsupported/);
  await assert.rejects(adapter.execute({ provider, modelId: "MiniMax-H3", input: { prompt: "reference", firstFrameUrl: "/private/local.png" } }, cancellation), /provider_media_role_unsupported/);
  assert.equal(count, 1);
});

test("protected Relay downloads never forward credentials to external redirects or other paths", async () => {
  const calls: { url: string; authorization: string | null; redirect?: RequestRedirect }[] = [];
  const download = createCheapBuddyMediaFetch(baseUrl, "fixture-key", async (input, init) => {
    calls.push({ url: String(input), authorization: new Headers(init?.headers).get("authorization"), redirect: init?.redirect });
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: "https://cdn.test/video.mp4" } }) : new Response("video", { status: 200 });
  });
  await download(`${baseUrl}/videos/video-1/content`);
  await download(`${baseUrl}/models`, { headers: { authorization: "Bearer accidental-key" } });
  await download("https://cdn.test/another.mp4");
  assert.deepEqual(calls.map((call) => call.authorization), ["Bearer fixture-key", null, null, null]);
  assert.ok(calls.every((call) => call.redirect === "manual"));
  assert.throws(() => createCheapBuddyMediaFetch("https://malicious.test/v1", "fixture"), /cheapbuddy_media_origin_invalid/);
  await assert.rejects(download("http://cdn.test/insecure.mp4"), /cheapbuddy_media_download_protocol_invalid/);
});
