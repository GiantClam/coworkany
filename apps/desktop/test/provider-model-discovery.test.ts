import test from "node:test";
import assert from "node:assert/strict";
import { buildProviderModelEndpointCandidates, discoverProviderModels, normalizeProviderModelResponse } from "../src/provider-model-discovery";

test("OpenAI-compatible discovery probes both host-root and /v1 layouts", () => {
  assert.deepEqual(buildProviderModelEndpointCandidates({ source: "openai-compatible", baseUrl: "https://proxy.example.test" }), [
    "https://proxy.example.test/models",
    "https://proxy.example.test/v1/models",
  ]);
  assert.deepEqual(buildProviderModelEndpointCandidates({ source: "newapi", baseUrl: "https://proxy.example.test/v1" }), [
    "https://proxy.example.test/v1/models",
    "https://proxy.example.test/models",
  ]);
});

test("Sub2API and NewAPI-compatible responses keep only model IDs", async () => {
  const requests: string[] = [];
  const result = await discoverProviderModels(
    { source: "pptoken", baseUrl: "https://pptoken.example.test/v1", apiKey: "secret" },
    async (input, init) => {
      requests.push(String(input));
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer secret");
      return new Response(JSON.stringify({ object: "list", data: [{ id: "grok-4.6" }, { model: "qwen-max" }, { id: "grok-4.6" }] }), { status: 200 });
    },
  );
  assert.deepEqual(result.models, ["grok-4.6", "qwen-max"]);
  assert.deepEqual(requests, ["https://pptoken.example.test/v1/models"]);
});

test("Gemini uses the official key header and removes the models/ resource prefix", async () => {
  let request: { url: string; headers: Headers } | undefined;
  const result = await discoverProviderModels(
    { source: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", apiKey: "gemini-secret" },
    async (input, init) => {
      request = { url: String(input), headers: new Headers(init?.headers) };
      return new Response(JSON.stringify({ models: [{ name: "models/gemini-3.7-flash", baseModelId: "gemini-3.7-flash" }] }), { status: 200 });
    },
  );
  assert.equal(request?.url, "https://generativelanguage.googleapis.com/v1beta/models");
  assert.equal(request?.headers.get("x-goog-api-key"), "gemini-secret");
  assert.deepEqual(result.models, ["gemini-3.7-flash"]);
});

test("DashScope discovery uses the official /api/v1/models directory", async () => {
  let url = "";
  const result = await discoverProviderModels(
    { source: "qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiKey: "dashscope-secret" },
    async (input) => {
      url = String(input);
      return new Response(JSON.stringify({ data: [{ id: "qwen-plus" }] }), { status: 200 });
    },
  );
  assert.equal(url, "https://dashscope.aliyuncs.com/api/v1/models");
  assert.deepEqual(result.models, ["qwen-plus"]);
});

test("DashScope requests only the selected media capability", async () => {
  let url = "";
  const result = await discoverProviderModels(
    { source: "bailian", baseUrl: "https://workspace.cn-beijing.maas.aliyuncs.com", apiKey: "dashscope-secret", capability: "video" },
    async (input) => {
      url = String(input);
      return new Response(JSON.stringify({ output: { models: [{ model: "happyhorse-1.1-t2v", capabilities: ["VG"] }, { model: "qwen-plus", capabilities: ["TG"] }] } }), { status: 200 });
    },
  );
  assert.equal(url, "https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/models?capabilities=VG&page_no=1&page_size=100");
  assert.deepEqual(result.models, ["happyhorse-1.1-t2v"]);
});

test("untyped generic model lists cannot populate a media provider", async () => {
  await assert.rejects(
    discoverProviderModels(
      { source: "openai-compatible", baseUrl: "https://proxy.example.test/v1", apiKey: "secret", capability: "video" },
      async () => new Response(JSON.stringify({ data: [{ id: "gpt-5.6" }] }), { status: 200 }),
    ),
    /provider_model_list_empty/,
  );
});

test("DashScope falls back to the authorized-model directory when the legacy list endpoint is unavailable", async () => {
  const requests: string[] = [];
  const result = await discoverProviderModels(
    { source: "bailian", baseUrl: "https://dashscope.aliyuncs.com", apiKey: "dashscope-secret" },
    async (input) => {
      const url = String(input);
      requests.push(url);
      if (url === "https://dashscope.aliyuncs.com/api/v1/models") return new Response("", { status: 404 });
      return new Response(JSON.stringify({ output: { permissions: [{ model: "qwen-plus" }, { model: "qwen-image-plus" }] } }), { status: 200 });
    },
  );
  assert.deepEqual(requests, [
    "https://dashscope.aliyuncs.com/api/v1/models",
    "https://dashscope.aliyuncs.com/api/v1/models/permissions?authorization_scope=AUTHORIZED&action=INFERENCE&page_no=1&page_size=100",
  ]);
  assert.equal(result.endpoint, requests[1]);
  assert.deepEqual(result.models, ["qwen-plus", "qwen-image-plus"]);
});

test("invalid or unsupported base URLs fail before a network request", () => {
  assert.throws(() => buildProviderModelEndpointCandidates({ baseUrl: "file:///tmp/provider" }), /provider_base_url_protocol_unsupported/);
  assert.throws(() => buildProviderModelEndpointCandidates({ baseUrl: "not-a-url" }), /provider_base_url_invalid/);
});

test("empty model envelopes do not replace the user's manual model", () => {
  assert.deepEqual(normalizeProviderModelResponse({ object: "list", data: [] }, { source: "openai-compatible", baseUrl: "https://example.test/v1" }), []);
});
