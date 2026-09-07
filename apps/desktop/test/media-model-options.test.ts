import assert from "node:assert/strict"
import test from "node:test"
import { resolveWorkbenchMediaFeature, WORKBENCH_MEDIA_FEATURES } from "@coworkany/workbench-ui"
import { applyConfiguredMediaModels } from "../src/media-model-options"

test("media model fields expose the configured catalog and selected model", () => {
  const feature = WORKBENCH_MEDIA_FEATURES.find((item) => item.id === "voice-synthesis")!
  const resolved = applyConfiguredMediaModels(feature, ["speech-2.8-turbo", "speech-2.8-hd", "speech-2.8-turbo"], "speech-2.8-hd")
  const modelField = resolved.fields.find((field) => field.id === "model")!
  assert.equal(modelField.defaultValue, "speech-2.8-hd")
  assert.deepEqual(modelField.options?.map((option) => option.value), ["speech-2.8-turbo", "speech-2.8-hd"])
})

test("video features retain arbitrary model IDs from the configured video profile", () => {
  const feature = WORKBENCH_MEDIA_FEATURES.find((item) => item.id === "text-to-video")!
  const resolved = applyConfiguredMediaModels(feature, ["account-model-a", "account-model-b"], "removed-model")
  const modelField = resolved.fields.find((field) => field.id === "model")!
  assert.equal(modelField.defaultValue, "account-model-a")
  assert.deepEqual(modelField.options?.map((option) => option.value), ["account-model-a", "account-model-b"])
})

test("media tabs use the selected capability profile when it has no model catalog", () => {
  const feature = WORKBENCH_MEDIA_FEATURES.find((item) => item.id === "text-to-video")!
  const resolved = applyConfiguredMediaModels(feature, [], "MiniMax-Hailuo-H3")
  const modelField = resolved.fields.find((field) => field.id === "model")!
  assert.equal(modelField.defaultValue, "MiniMax-Hailuo-H3")
  assert.deepEqual(modelField.options?.map((option) => option.value), ["MiniMax-Hailuo-H3"])
})

test("audio features retain the configured audio profile without model-name heuristics", () => {
  const feature = WORKBENCH_MEDIA_FEATURES.find((item) => item.id === "ai-music")!
  const resolved = applyConfiguredMediaModels(feature, ["speech-2.8-hd", "speech-2.8-turbo"], "speech-2.8-hd")
  const modelField = resolved.fields.find((field) => field.id === "model")!
  assert.deepEqual(modelField.options?.map((option) => option.value), ["speech-2.8-hd", "speech-2.8-turbo"])
  assert.equal(modelField.defaultValue, "speech-2.8-hd")
})

test("video feature fields follow the online model parameter contract", () => {
  const feature = WORKBENCH_MEDIA_FEATURES.find((item) => item.id === "image-to-video")!
  const resolved = resolveWorkbenchMediaFeature(feature, "bailian:video:happyhorse-1.1-i2v")
  assert.deepEqual(resolved.fields.map((field) => field.id), [
    "model",
    "firstFrameUrl",
    "prompt",
    "resolution",
    "ratio",
    "duration",
    "watermark",
    "seed",
  ])
  assert.equal(resolved.fields.find((field) => field.id === "firstFrameUrl")?.required, true)
})

test("video edit exposes online source, audio, and generation controls", () => {
  const feature = WORKBENCH_MEDIA_FEATURES.find((item) => item.id === "video-edit")!
  const resolved = resolveWorkbenchMediaFeature(feature, "runninghub:video:seedance-pro-text-to-video")
  const ids = new Set(resolved.fields.map((field) => field.id))
  for (const id of ["sourceVideoUrl", "referenceImageUrls", "audioSetting", "seed"]) assert.equal(ids.has(id), true, id)
})

test("reference video follows the online HappyHorse schema", () => {
  const feature = WORKBENCH_MEDIA_FEATURES.find((item) => item.id === "reference-to-video")!
  const resolved = resolveWorkbenchMediaFeature(feature, "bailian:video:happyhorse-1.1-r2v")
  assert.deepEqual(resolved.fields.map((field) => field.id), [
    "model",
    "referenceImageUrls",
    "prompt",
    "resolution",
    "ratio",
    "duration",
    "watermark",
    "seed",
  ])
})

test("HappyHorse video edit omits generation-only controls", () => {
  const feature = WORKBENCH_MEDIA_FEATURES.find((item) => item.id === "video-edit")!
  const resolved = resolveWorkbenchMediaFeature(feature, "bailian:video:happyhorse-1.0-video-edit")
  assert.deepEqual(resolved.fields.map((field) => field.id), [
    "model",
    "sourceVideoUrl",
    "referenceImageUrls",
    "prompt",
    "resolution",
    "watermark",
    "audioSetting",
    "seed",
  ])
})

test("Seedance exposes version-specific online controls", () => {
  const feature = WORKBENCH_MEDIA_FEATURES.find((item) => item.id === "image-to-video")!
  const resolved = resolveWorkbenchMediaFeature(feature, "runninghub:video:seedance-pro-image-to-video")
  const ids = new Set(resolved.fields.map((field) => field.id))
  for (const id of ["firstFrameUrl", "lastFrameUrl", "generateAudio", "realPersonMode", "returnLastFrame", "seed"]) assert.equal(ids.has(id), true, id)
})

test("Grok Imagine video exposes compatible async generation controls", () => {
  const feature = WORKBENCH_MEDIA_FEATURES.find((item) => item.id === "text-to-video")!
  const resolved = resolveWorkbenchMediaFeature(feature, "grok-imagine-video-1.5")
  assert.deepEqual(resolved.fields.map((field) => field.id), ["model", "prompt", "duration", "resolution", "ratio"])
  assert.equal(resolved.fields.find((field) => field.id === "prompt")?.required, true)
  assert.deepEqual(resolved.fields.find((field) => field.id === "resolution")?.options?.map((option) => option.value), ["480p", "720p", "1080p"])
})
