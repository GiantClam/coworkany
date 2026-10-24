import assert from "node:assert/strict"
import test from "node:test"

import {
  getDefaultModelId,
  findModelByCapabilityAndAlias,
  getModelDefinition,
  listModels,
  validateAndNormalizeModelInput,
} from "@/lib/ai-runtime/model-registry"
import { MODEL_CAPABILITIES } from "@/lib/ai-runtime/capabilities"
import { getProviderAdapter } from "@/lib/ai-runtime/provider-registry"

test("listModels exposes every capability with unique model ids", () => {
  const allModels = listModels()
  const ids = new Set(allModels.map((model) => model.id))
  assert.equal(ids.size, allModels.length)

  for (const capability of MODEL_CAPABILITIES) {
    assert.ok(listModels({ capability }).length > 0, `missing models for ${capability}`)
    assert.ok(getDefaultModelId(capability), `missing default model for ${capability}`)
  }
})

test("text capability defaults to GPT-6.1 and does not resolve retired GPT-5 IDs", () => {
  assert.equal(getDefaultModelId("text.generate"), "openai:text:gpt-6.1-sol")
  assert.equal(getModelDefinition("openai:text:gpt-6.1-sol")?.providerMetadata?.nativeModel, "gpt-6.1-sol")
  assert.equal(getModelDefinition("openai:text:gpt-5.4-mini"), null)
  assert.equal(
    findModelByCapabilityAndAlias({ capability: "text.generate", value: "gpt-5.4-mini" }),
    null,
  )
})

test("every model default value is valid for its parameter schema", () => {
  for (const model of listModels()) {
    const defaults = Object.fromEntries(
      model.parameterSchema.map((field) => [
        field.id,
        field.defaultValue ??
          (field.type === "number"
            ? 1
            : field.type === "url"
              ? "https://example.com/input"
              : field.type === "select"
                ? field.options?.[0]?.value ?? "default"
                : "placeholder"),
      ]),
    )

    assert.doesNotThrow(() => validateAndNormalizeModelInput(model, defaults))
  }
})

test("every provider in the registry resolves to an adapter", () => {
  for (const model of listModels()) {
    assert.ok(getProviderAdapter(model.provider), `missing provider adapter for ${model.provider}`)
  }
})

test("shared MiniMax provider selects the adapter by model capability", () => {
  const audioAdapter = getProviderAdapter("minimax", "audio.generate")
  const videoAdapter = getProviderAdapter("minimax", "video.text_to_video")

  assert.equal(audioAdapter?.capabilities?.includes("audio.generate"), true)
  assert.equal(videoAdapter?.capabilities?.includes("video.text_to_video"), true)
  assert.notEqual(audioAdapter, videoAdapter)
})

test("validateAndNormalizeModelInput drops unsupported parameters", () => {
  const model = getModelDefinition("minimax:video:text-to-video:MiniMax-Hailuo-2.3")
  assert.ok(model)

  const normalized = validateAndNormalizeModelInput(model!, {
    prompt: "Launch film",
    resolution: "1080P",
    duration: "10",
    unknownField: "should-be-dropped",
  })

  assert.equal("unknownField" in normalized, false)
  assert.equal(normalized.resolution, "1080P")
})

test("model registry exposes RunningHub seedance mini video models", () => {
  const textModel = getModelDefinition("runninghub:video:seedance-mini-text-to-video")
  const imageModel = getModelDefinition("runninghub:video:seedance-mini-image-to-video")

  assert.equal(textModel?.provider, "runninghub")
  assert.equal(textModel?.capability, "video.text_to_video")
  assert.equal(textModel?.providerMetadata?.nativeModel, "seedance-mini-text-to-video")

  assert.equal(imageModel?.provider, "runninghub")
  assert.equal(imageModel?.capability, "video.image_to_video")
  assert.equal(imageModel?.providerMetadata?.nativeModel, "seedance-mini-image-to-video")
})

test("model registry exposes RunningHub Seedance Pro text and image video models", () => {
  const textModel = getModelDefinition("runninghub:video:seedance-pro-text-to-video")
  const imageModel = getModelDefinition("runninghub:video:seedance-pro-image-to-video")

  assert.equal(textModel?.provider, "runninghub")
  assert.equal(textModel?.capability, "video.text_to_video")
  assert.equal(textModel?.providerMetadata?.nativeModel, "seedance-pro-text-to-video")

  assert.equal(imageModel?.provider, "runninghub")
  assert.equal(imageModel?.capability, "video.image_to_video")
  assert.equal(imageModel?.providerMetadata?.nativeModel, "seedance-pro-image-to-video")
})

test("model registry exposes MiniMax-H3 multimodal RunningHub video models", () => {
  const textModel = getModelDefinition("runninghub:video:minimax-h3-text-to-video")
  const imageModel = getModelDefinition("runninghub:video:minimax-h3-image-to-video")
  const referenceModel = getModelDefinition("runninghub:video:minimax-h3-reference-to-video")

  assert.equal(textModel?.capability, "video.text_to_video")
  assert.equal(imageModel?.capability, "video.image_to_video")
  assert.equal(referenceModel?.capability, "video.reference_to_video")
  assert.equal(referenceModel?.providerMetadata?.nativeModel, "minimax-h3-reference-to-video")
  assert.equal(
    findModelByCapabilityAndAlias({ capability: "video.reference_to_video", value: "MiniMax-H3" })?.id,
    "runninghub:video:minimax-h3-reference-to-video",
  )
})

test("model registry exposes only the supported MiniMax video models", () => {
  const videoModels = listModels()
    .filter((model) => model.provider === "minimax" && model.outputKind === "video")
    .map((model) => model.providerMetadata?.nativeModel)

  assert.deepEqual(videoModels, [
    "MiniMax-Hailuo-2.3",
    "MiniMax-Hailuo-2.3",
    "MiniMax-Hailuo-2.3-Fast",
  ])
  assert.equal(getModelDefinition("minimax:video:text-to-video:MiniMax-Hailuo-02-Pro"), null)
  assert.equal(getModelDefinition("minimax:video:text-to-video:T2V-01"), null)
})

test("model registry exposes Bailian Qwen Image and HappyHorse models", () => {
  const qwenText = getModelDefinition("bailian:image:qwen-image-3.0-pro")
  const qwenEdit = getModelDefinition("bailian:image:qwen-image-2.7-edit")
  const happyHorse = getModelDefinition("bailian:video:happyhorse-1.1-t2v")
  const happyHorseImage = getModelDefinition("bailian:video:happyhorse-1.1-i2v")
  const happyHorseReference = getModelDefinition("bailian:video:happyhorse-1.1-r2v")
  const happyHorseEdit = getModelDefinition("bailian:video:happyhorse-1.0-video-edit")

  assert.equal(qwenText?.provider, "bailian")
  assert.equal(qwenText?.capability, "image.text_to_image")
  assert.equal(qwenText?.providerMetadata?.nativeModel, "qwen-image-3.0-pro")
  assert.equal(qwenEdit?.capability, "image.image_to_image")
  assert.equal(qwenEdit?.providerMetadata?.nativeModel, "qwen-image-2.7")
  assert.equal(happyHorse?.capability, "video.text_to_video")
  assert.equal(happyHorse?.providerMetadata?.nativeModel, "happyhorse-1.1-t2v")
  assert.equal(happyHorseImage?.capability, "video.image_to_video")
  assert.equal(happyHorseReference?.capability, "video.reference_to_video")
  assert.equal(happyHorseEdit?.capability, "video.video_edit")
})

test("image model aliases resolve the parameter schema used by the assistant", () => {
  const nanobanana = findModelByCapabilityAndAlias({
    capability: "image.text_to_image",
    value: "Nanobanana2",
  })
  const seedream = findModelByCapabilityAndAlias({
    capability: "image.text_to_image",
    value: "seedream-v5-text-to-image",
  })
  const qwen = findModelByCapabilityAndAlias({
    capability: "image.text_to_image",
    value: "qwen-image-3.0-pro",
  })

  assert.equal(nanobanana?.id, "google:image:nanobanana2")
  assert.ok(nanobanana?.parameterSchema.some((field) => field.id === "resolution"))
  assert.equal(seedream?.id, "runninghub:image:seedream-v5-text-to-image")
  assert.ok(seedream?.parameterSchema.some((field) => field.id === "size"))
  assert.equal(qwen?.id, "bailian:image:qwen-image-3.0-pro")
  assert.ok(qwen?.parameterSchema.some((field) => field.id === "negativePrompt"))
})

test("OpenAI image model and adapter are opt-in behind the workflow feature flag", async () => {
  const previous = process.env.WORKFLOW_OPENAI_IMAGE_ADAPTER_V1
  try {
    delete process.env.WORKFLOW_OPENAI_IMAGE_ADAPTER_V1
    assert.equal(getModelDefinition("openai:image:gpt-image-2"), null)
    assert.equal(
      getProviderAdapter("openai_compatible", "image.text_to_image"),
      null,
    )

    process.env.WORKFLOW_OPENAI_IMAGE_ADAPTER_V1 = "1"
    assert.equal(getModelDefinition("openai:image:gpt-image-2")?.id, "openai:image:gpt-image-2")
    assert.ok(getProviderAdapter("openai_compatible", "image.text_to_image"))
  } finally {
    if (previous === undefined) delete process.env.WORKFLOW_OPENAI_IMAGE_ADAPTER_V1
    else process.env.WORKFLOW_OPENAI_IMAGE_ADAPTER_V1 = previous
  }
})
