import assert from "node:assert/strict";
import test from "node:test";
import { buildMediaCapabilityInput } from "../runtime/media-input";
import { assertVideoMediaCapability, resolveVideoMediaCapabilities } from "../runtime/media-capabilities";

test("maps canvas image fields to the OpenAI-compatible image payload without transport configuration", () => {
  const input = buildMediaCapabilityInput("image_generate", {
    provider: "image-main", model: "gpt-image-2", baseUrl: "https://provider.example/v1", apiKey: "not-forwarded",
    imageSize: "1536x1024", imageQuality: "high", imageBackground: "opaque", imageOutputFormat: "webp", imageOutputCompression: 75, imageModeration: "low",
  }, { text: "A product launch image" });
  assert.deepEqual(input, {
    imageSize: "1536x1024", imageQuality: "high", imageBackground: "opaque", imageOutputFormat: "webp", imageOutputCompression: 75, imageModeration: "low",
    text: "A product launch image", prompt: "A product launch image", size: "1536x1024", quality: "high", background: "opaque", output_format: "webp", output_compression: 75, moderation: "low",
  });
});

test("does not send PNG compression and normalizes image edit references", () => {
  const input = buildMediaCapabilityInput("image_generate", {
    imageSize: "1024x1024", imageQuality: "auto", imageOutputFormat: "png", imageOutputCompression: 80,
  }, {
    text: "Edit the product image", referenceImages: ["https://cdn.example.test/product.png"], inputImageUrl: "https://cdn.example.test/product.png",
  });
  assert.equal(input.output_compression, undefined);
  assert.deepEqual(input.referenceImageUrls, ["https://cdn.example.test/product.png"]);
  assert.equal("referenceImages" in input, false);
  assert.equal("inputImageUrl" in input, false);
});

test("passes local workflow images to the compatible image adapter as references", () => {
  const input = buildMediaCapabilityInput("image_generate", {}, {
    images: [{ fileName: "reference.png", mimeType: "image/png", localPath: "C:\\media\\reference.png" }],
  });
  assert.deepEqual(input.localAttachments, ["C:\\media\\reference.png"]);
  assert.deepEqual(input.referenceImageUrls, ["C:\\media\\reference.png"]);
});

test("marks raw local reference paths as workflow attachments", () => {
  const input = buildMediaCapabilityInput("image_generate", {}, {
    referenceImages: ["C:\\media\\raw-reference.png"],
  });
  assert.deepEqual(input.localAttachments, ["C:\\media\\raw-reference.png"]);
  assert.deepEqual(input.referenceImageUrls, ["C:\\media\\raw-reference.png"]);
});

test("preserves local video image roles for provider-specific data-url conversion", () => {
  const input = buildMediaCapabilityInput("video_generate", {}, {
    images: [{ fileName: "first.png", mimeType: "image/png", localPath: "C:\\media\\first.png" }],
    "image.last_frame": [{ fileName: "last.png", mimeType: "image/png", localPath: "C:\\media\\last.png" }],
    referenceImages: [{ fileName: "reference.png", mimeType: "image/png", localPath: "C:\\media\\reference.png" }],
  });
  assert.equal(input.firstFrameUrl, "C:\\media\\first.png");
  assert.equal(input.lastFrameUrl, "C:\\media\\last.png");
  assert.deepEqual(input.referenceImageUrls, ["C:\\media\\reference.png"]);
  assert.deepEqual(input.localAttachments, ["C:\\media\\first.png", "C:\\media\\last.png", "C:\\media\\reference.png"]);
});

test("maps the canonical first-frame role input to the video provider field", () => {
  const input = buildMediaCapabilityInput("video_generate", { firstFrameUrl: "C:\\media\\stale-configured-first.png" }, {
    "image.first_frame": [{ fileName: "first.png", mimeType: "image/png", localPath: "C:\\media\\canonical-first.png" }],
  });
  assert.equal(input.firstFrameUrl, "C:\\media\\canonical-first.png");
  assert.deepEqual(input.localAttachments, ["C:\\media\\canonical-first.png"]);
});

test("prefers a provider URL when an upstream artifact also has a local cache path", () => {
  const input = buildMediaCapabilityInput("image_generate", {}, {
    referenceImages: [{ url: "https://files.example.test/reference.png", localPath: "C:\\media\\reference.png" }],
  });
  assert.deepEqual(input.referenceImageUrls, ["https://files.example.test/reference.png"]);
  assert.equal("localAttachments" in input, false);
});

test("tracks local frame paths configured directly on a video node", () => {
  const input = buildMediaCapabilityInput("video_generate", {
    firstFrameUrl: "C:\\media\\configured-first.png",
    lastFrameUrl: "C:\\media\\configured-last.png",
  }, {});
  assert.deepEqual(input.localAttachments, ["C:\\media\\configured-first.png", "C:\\media\\configured-last.png"]);
  assert.equal(input.firstFrameUrl, "C:\\media\\configured-first.png");
  assert.equal(input.lastFrameUrl, "C:\\media\\configured-last.png");
});

test("maps provider-specific image parameters without losing their native names", () => {
  const input = buildMediaCapabilityInput("image_generate", {
    imageSize: "1536x1024", imageNegativePrompt: "blurry", imageCandidateCount: "3", imagePromptExtend: "false", imageWatermark: "true", imageSeed: "42",
  }, { text: "A product image" });
  assert.equal(input.size, "1536x1024");
  assert.equal(input.negativePrompt, "blurry");
  assert.equal(input.n, "3");
  assert.equal(input.promptExtend, "false");
  assert.equal(input.watermark, "true");
  assert.equal(input.seed, "42");
});

test("routes music and speech nodes to their intended MiniMax operation", () => {
  const music = buildMediaCapabilityInput("music_generate", { provider: "audio-minimax", model: "music-2.6", prompt: "Cinematic instrumental" }, {});
  assert.equal(music.kind, "music");
  assert.equal(music.featureId, "ai-music");
  assert.equal(music.prompt, "Cinematic instrumental");

  const speech = buildMediaCapabilityInput("voice_synthesis", { provider: "audio-minimax", model: "speech-2.8-turbo", text: "Hello" }, {});
  assert.equal(speech.kind, "speech");
  assert.equal(speech.text, "Hello");
  assert.equal("provider" in speech, false);
  assert.equal("model" in speech, false);
});

test("maps a music-cover source reference to MiniMax audio_url", () => {
  const music = buildMediaCapabilityInput("music_generate", { model: "music-cover", sourceAudioUrl: "https://example.test/original.mp3" }, {});
  assert.equal(music.kind, "music");
  assert.equal(music.audio_url, "https://example.test/original.mp3");
  assert.equal("sourceAudioUrl" in music, false);
});

test("uses upstream media outputs as video and digital-human references", () => {
  const video = buildMediaCapabilityInput("video_generate", { provider: "video-main", sound: "on" }, { images: ["https://example.test/first.png", "https://example.test/last.png"] });
  assert.equal(video.firstFrameUrl, "https://example.test/first.png");
  assert.equal(video.lastFrameUrl, "https://example.test/last.png");
  assert.equal(video.generateAudio, true);

  const digitalHuman = buildMediaCapabilityInput("digital_human", {}, { images: ["https://example.test/avatar.png"], audios: ["https://example.test/speech.mp3"] });
  assert.equal(digitalHuman.avatarImageUrl, "https://example.test/avatar.png");
  assert.equal(digitalHuman.audioUrl, "https://example.test/speech.mp3");
});

test("keeps workflow local file paths out of node metadata and exposes them only as runtime attachments", () => {
  const input = buildMediaCapabilityInput("voice_clone", {}, {
    assets: [{ fileName: "reference.wav", mimeType: "audio/wav", byteLength: 2048, localPath: "C:\\media\\reference.wav" }],
  });
  assert.deepEqual(input.localAttachments, ["C:\\media\\reference.wav"]);
  assert.equal(JSON.stringify(input).includes("localPath"), false);
});

test("keeps role-specific video media inputs distinct and ordered", () => {
  const input = buildMediaCapabilityInput("video_generate", { mode: "auto", sound: "off" }, {
    images: ["https://example.test/first.png"],
    "image.last_frame": ["https://example.test/last.png"],
    referenceImages: ["https://example.test/reference-1.png", "https://example.test/reference-2.png"],
    videos: ["https://example.test/source.mp4"],
    referenceVideos: ["https://example.test/reference-1.mp4", "https://example.test/reference-2.mp4"],
    referenceAudios: ["https://example.test/reference.mp3"],
  });
  assert.equal(input.firstFrameUrl, "https://example.test/first.png");
  assert.equal(input.lastFrameUrl, "https://example.test/last.png");
  assert.deepEqual(input.referenceImageUrls, ["https://example.test/reference-1.png", "https://example.test/reference-2.png"]);
  assert.equal(input.sourceVideoUrl, "https://example.test/source.mp4");
  assert.deepEqual(input.referenceVideoUrls, ["https://example.test/reference-1.mp4", "https://example.test/reference-2.mp4"]);
  assert.deepEqual(input.referenceAudioUrls, ["https://example.test/reference.mp3"]);
});

test("maps every canonical media role and legacy config field to provider inputs", () => {
  const input = buildMediaCapabilityInput("video_generate", {
    sourceVideoUrl: "C:\\media\\configured-source.mp4",
    videoUrls: ["C:\\media\\configured-reference.mp4"],
    audioUrls: ["C:\\media\\configured-reference.mp3"],
  }, {
    "image.first_frame": [{ localPath: "C:\\media\\first.png" }],
    "image.last_frame": [{ localPath: "C:\\media\\last.png" }],
    "image.reference": [{ localPath: "C:\\media\\reference.png" }],
    "video.source": [{ localPath: "C:\\media\\source.mp4" }],
    "video.reference": [{ localPath: "C:\\media\\reference-1.mp4" }, { localPath: "C:\\media\\reference-2.mp4" }],
    "audio.reference": [{ localPath: "C:\\media\\reference.wav" }],
  });
  assert.equal(input.firstFrameUrl, "C:\\media\\first.png");
  assert.equal(input.lastFrameUrl, "C:\\media\\last.png");
  assert.deepEqual(input.referenceImageUrls, ["C:\\media\\reference.png"]);
  assert.equal(input.sourceVideoUrl, "C:\\media\\source.mp4");
  assert.deepEqual(input.referenceVideoUrls, ["C:\\media\\reference-1.mp4", "C:\\media\\reference-2.mp4"]);
  assert.deepEqual(input.referenceAudioUrls, ["C:\\media\\reference.wav"]);
  assert.equal((input.localMediaReferences as { sourceVideo: unknown[] }).sourceVideo.length, 1);
  assert.equal((input.localMediaReferences as { referenceVideos: unknown[] }).referenceVideos.length, 2);
  assert.equal((input.localMediaReferences as { referenceAudios: unknown[] }).referenceAudios.length, 1);
});

test("keeps the shared media normalizer within the broadest supported reference limits", () => {
  const input = buildMediaCapabilityInput("video_generate", {
    mode: "reference-to-video",
    referenceImageUrls: Array.from({ length: 10 }, (_, index) => `https://example.test/ref-${index}.png`),
    referenceVideoUrls: Array.from({ length: 5 }, (_, index) => `https://example.test/ref-${index}.mp4`),
    referenceAudioUrls: Array.from({ length: 5 }, (_, index) => `https://example.test/ref-${index}.mp3`),
  }, {});
  assert.equal((input.referenceImageUrls as string[] | undefined)?.length, 10);
  assert.equal((input.referenceVideoUrls as string[] | undefined)?.length, 5);
  assert.equal((input.referenceAudioUrls as string[] | undefined)?.length, 5);
});

test("requires the role-specific inputs selected by video mode", () => {
  assert.throws(() => buildMediaCapabilityInput("video_generate", { mode: "first-last-frame" }, {
    images: ["https://example.test/first.png"],
  }), /workflow_media_role_required:first-last-frame/);
  assert.throws(() => buildMediaCapabilityInput("video_generate", { mode: "video-edit" }, {}), /workflow_media_role_required:video.source/);
});

test("enforces the selected provider's reference limit before submission", () => {
  const profile = resolveVideoMediaCapabilities("bailian", "happyhorse-1.1-r2v");
  assert.throws(() => assertVideoMediaCapability(profile, { referenceImageUrls: ["1", "2", "3", "4"] }), /workflow_media_role_limit:image.reference:3/);
});

test("treats the DashScope provider alias as the Bailian media contract", () => {
  const profile = resolveVideoMediaCapabilities("dashscope", "wan3.0-video-prime");
  assert.equal(profile.supportsReferenceImages, true);
  assert.equal(profile.supportsFirstFrame, true);
});
