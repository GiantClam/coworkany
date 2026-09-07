import assert from "node:assert/strict";
import test from "node:test";
import { buildDesktopImageRunInput, getDesktopImageParameterSchema, normalizeDesktopImageSettings, resolveDesktopImageModelKind } from "../src/image-model-parameters";

test("recognizes the online image model aliases", () => {
  assert.equal(resolveDesktopImageModelKind("openai:image:gpt-image-2"), "gpt-image-2");
  assert.equal(resolveDesktopImageModelKind("google:image:nanobanana2"), "nanobanana-2");
  assert.equal(resolveDesktopImageModelKind("gemini-2.5-flash-image"), "nanobanana-2");
  assert.equal(resolveDesktopImageModelKind("runninghub:image:seedream-v5-text-to-image"), "seedream-text-to-image");
  assert.equal(resolveDesktopImageModelKind("seedream-v5-image-to-image"), "seedream-image-to-image");
});

test("each image model exposes only its online parameter fields", () => {
  assert.deepEqual(getDesktopImageParameterSchema("gpt-image-2", "en").map((field) => field.id), ["size", "quality", "background", "outputFormat", "outputCompression", "moderation", "responseFormat", "candidateCount", "referenceImages"]);
  assert.deepEqual(getDesktopImageParameterSchema("nanobanana2", "en").map((field) => field.id), ["size", "resolution", "referenceImages"]);
  assert.deepEqual(getDesktopImageParameterSchema("seedream-v5-text-to-image", "en").map((field) => field.id), ["size"]);
  assert.deepEqual(getDesktopImageParameterSchema("seedream-v5-image-to-image", "en").map((field) => field.id), ["size", "inputImageUrl"]);
  assert.deepEqual(getDesktopImageParameterSchema("qwen-image-3.0-pro-edit", "en").map((field) => field.id), ["size", "negativePrompt", "candidateCount", "referenceImages"]);
  assert.deepEqual(getDesktopImageParameterSchema("qwen-image-2.7", "en").map((field) => field.id), ["size", "referenceImages"]);
});

test("model switching drops stale fields and applies model defaults", () => {
  const gpt = normalizeDesktopImageSettings("gpt-image-2", { quality: "high", candidateCount: "3", resolution: "4K" });
  assert.equal(gpt.quality, "high");
  assert.equal(gpt.candidateCount, "3");
  assert.equal(gpt.responseFormat, "url");
  assert.equal(normalizeDesktopImageSettings("gpt-image-2", { responseFormat: "b64_json" }).responseFormat, "url");
  assert.equal("resolution" in gpt, false);
  const nano = normalizeDesktopImageSettings("nanobanana2", gpt);
  assert.deepEqual(nano, { size: "1:1", resolution: "2K", referenceImages: "" });
});

test("run input maps only supported fields to provider payload names", () => {
  const input = buildDesktopImageRunInput("gpt-image-2", {
    size: "1536x1024", quality: "high", outputFormat: "jpeg", outputCompression: "72", candidateCount: "3", resolution: "4K", referenceImages: "one.png, two.png",
  }, ["local.png"]);
  assert.deepEqual(input, { size: "1536x1024", quality: "high", output_format: "jpeg", output_compression: 72, n: 3, referenceImages: ["one.png", "two.png"], localAttachments: ["local.png"] });
  assert.deepEqual(buildDesktopImageRunInput("nanobanana2", { size: "16:9", resolution: "4K", quality: "high" }), { size: "16:9", resolution: "4K" });
});

test("Grok Imagine image uses the generic compatible image panel", () => {
  assert.equal(resolveDesktopImageModelKind("grok-imagine-image-2.0"), "generic");
  assert.deepEqual(getDesktopImageParameterSchema("grok-imagine-image-2.0", "en").map((field) => field.id), ["quality", "size", "count", "referenceImages"]);
  assert.deepEqual(buildDesktopImageRunInput("grok-imagine-image-2.0", { quality: "hd", size: "1024x1024", count: "1" }), { quality: "hd", size: "1024x1024", n: 1 });
});
