const TRANSPORT_CONFIG_KEYS = new Set([
  "provider",
  "selectedProviderId",
  "selectedModelId",
  "model",
  "baseUrl",
  "apiKey",
  "endpoint",
  "queryEndpoint",
]);

function firstNonEmptyString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function firstUrl(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!Array.isArray(value)) return undefined;
  return value.find((item): item is string => typeof item === "string" && item.trim().length > 0)?.trim();
}

function secondUrl(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.slice(1).find((item): item is string => typeof item === "string" && item.trim().length > 0)?.trim();
}

function isLocalPath(value: unknown): value is string {
  return typeof value === "string" && /^(?:[a-zA-Z]:[\\/]|\\\\|\/)/u.test(value.trim());
}

export type MediaAssetReference = {
  readonly url?: string;
  readonly localPath?: string;
  readonly fileName?: string;
  readonly mimeType?: string;
  readonly byteLength?: number;
};

function collectMediaReferences(value: unknown, references: MediaAssetReference[] = []): MediaAssetReference[] {
  if (Array.isArray(value)) {
    for (const item of value) collectMediaReferences(item, references);
    return references;
  }
  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim();
    references.push(isLocalPath(normalized) ? { localPath: normalized } : { url: normalized });
    return references;
  }
  if (!value || typeof value !== "object") return references;
  const record = value as Record<string, unknown>;
  const localPath = typeof record.localPath === "string" && record.localPath.trim() ? record.localPath.trim() : undefined;
  const url = firstNonEmptyString(record.url, record.uri, record.remoteUrl);
  if (localPath || url) references.push({
    ...(url ? { url } : {}),
    ...(localPath ? { localPath } : {}),
    ...(typeof record.fileName === "string" ? { fileName: record.fileName } : {}),
    ...(typeof record.mimeType === "string" ? { mimeType: record.mimeType } : {}),
    ...(typeof record.byteLength === "number" ? { byteLength: record.byteLength } : {}),
  });
  if (!localPath && !url) {
    for (const item of Object.values(record)) collectMediaReferences(item, references);
  }
  return references;
}

function omitLocalPaths(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(omitLocalPaths);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => key !== "localPath")
    .map(([key, item]) => [key, omitLocalPaths(item)]));
}

function uniqueReferences(references: readonly MediaAssetReference[]) {
  const keys = new Set<string>();
  return references.filter((reference) => {
    const key = reference.localPath ?? reference.url ?? `${reference.fileName ?? ""}:${reference.mimeType ?? ""}:${reference.byteLength ?? ""}`;
    if (!key || keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

function preferredMediaReferences(...values: unknown[]) {
  for (const value of values) {
    const references = uniqueReferences(collectMediaReferences(value));
    if (references.length) return references;
  }
  return [];
}

function hasMediaReferences(...values: unknown[]) {
  return values.some((value) => collectMediaReferences(value).length > 0);
}

function urlsFor(value: unknown) {
  return uniqueReferences(collectMediaReferences(value)).flatMap((reference) => reference.url ? [reference.url] : []);
}

function assertMaximum(role: string, references: readonly MediaAssetReference[], maximum: number) {
  if (references.length > maximum) throw new Error(`workflow_media_role_limit:${role}:${maximum}`);
}

/**
 * Keep canvas-facing parameter names independent from the direct provider
 * payload. Provider profiles are transport configuration, not generation
 * inputs, and must never be forwarded to third parties.
 */
export function buildMediaCapabilityInput(executorId: string, config: Record<string, unknown>, inputs: Record<string, unknown>) {
  // A generated upstream artifact may contain both a local cache path and a
  // provider URL. Only path-only references represent user-selected local
  // attachments that still need provider-specific handling.
  const hasInputImage = hasMediaReferences(inputs.inputImageUrl);
  const hasInputFirstFrame = hasMediaReferences(inputs["image.first_frame"], inputs.firstFrame, inputs.images, inputs.image);
  const hasInputLastFrame = hasMediaReferences(inputs["image.last_frame"], inputs.lastFrame, inputs.images);
  const configMediaSources = [
    config.referenceImages, config.referenceImageUrls, config.imageUrls,
    config.sourceVideoUrl, config.videos, config.video,
    config.referenceVideoUrls, config.referenceVideos, config.videoUrls,
    config.referenceAudioUrls, config.referenceAudios, config.audioUrls, config.audioUrl,
  ];
  const localAttachmentSource = {
    ...inputs,
    inputImageUrl: hasInputImage ? undefined : config.inputImageUrl,
    firstFrameUrl: hasInputFirstFrame ? undefined : config.firstFrameUrl,
    lastFrameUrl: hasInputLastFrame ? undefined : config.lastFrameUrl,
  };
  const localAttachments = [...new Set([
    ...uniqueReferences(collectMediaReferences(localAttachmentSource)).flatMap((reference) => reference.localPath && !reference.url ? [reference.localPath] : []),
    ...configMediaSources.flatMap((value) => uniqueReferences(collectMediaReferences(value)).flatMap((reference) => reference.localPath && !reference.url ? [reference.localPath] : [])),
    ...[
      hasInputImage ? undefined : config.inputImageUrl,
      hasInputFirstFrame ? undefined : config.firstFrameUrl,
      hasInputLastFrame ? undefined : config.lastFrameUrl,
    ].filter(isLocalPath).map((value) => value.trim()),
  ])];
  const safeConfig = omitLocalPaths(config) as Record<string, unknown>;
  const safeInputs = omitLocalPaths(inputs) as Record<string, unknown>;
  const request = Object.fromEntries(Object.entries({ ...safeConfig, ...safeInputs }).filter(([key]) => !TRANSPORT_CONFIG_KEYS.has(key))) as Record<string, unknown>;
  if (localAttachments.length) request.localAttachments = localAttachments;
  const prompt = firstNonEmptyString(inputs.text, config.prompt, config.script, config.text);
  if (prompt) request.prompt = prompt;

  if (executorId === "image_generate") {
    const referenceInput = inputs.referenceImages ?? inputs.images ?? inputs.image;
    const references = uniqueReferences(collectMediaReferences(referenceInput));
    assertMaximum("image.reference", references, 9);
    const inputImageUrl = firstNonEmptyString(config.inputImageUrl, inputs.inputImageUrl);
    const referenceImageUrls = [...new Set([
      ...urlsFor(referenceInput),
      ...references.flatMap((reference) => !reference.url && reference.localPath ? [reference.localPath] : []),
      ...(inputImageUrl ? [inputImageUrl] : []),
    ])];
    delete request.referenceImages;
    delete request.inputImageUrl;
    if (referenceImageUrls.length) request.referenceImageUrls = referenceImageUrls;
    const size = firstNonEmptyString(config.size, config.imageSize);
    const quality = firstNonEmptyString(config.quality, config.imageQuality);
    const background = firstNonEmptyString(config.background, config.imageBackground);
    const outputFormat = firstNonEmptyString(config.output_format, config.imageOutputFormat);
    const moderation = firstNonEmptyString(config.moderation, config.imageModeration);
    const compression = config.output_compression ?? config.imageOutputCompression;
    const negativePrompt = firstNonEmptyString(config.negativePrompt, config.imageNegativePrompt);
    const promptExtend = config.promptExtend ?? config.imagePromptExtend;
    const watermark = config.watermark ?? config.imageWatermark;
    const seed = config.seed ?? config.imageSeed;
    const count = config.n ?? config.imageCandidateCount;
    const style = firstNonEmptyString(config.style, config.imageStyle);
    if (size) request.size = size;
    if (quality) request.quality = quality;
    if (background) request.background = background;
    if (outputFormat) request.output_format = outputFormat;
    if (moderation) request.moderation = moderation;
    if (negativePrompt) request.negativePrompt = negativePrompt;
    if (promptExtend !== undefined && promptExtend !== "") request.promptExtend = promptExtend;
    if (watermark !== undefined && watermark !== "") request.watermark = watermark;
    if (seed !== undefined && seed !== "") request.seed = seed;
    if (count !== undefined && count !== "") request.n = count;
    if (style) request.style = style;
    // OpenAI-compatible image APIs only accept output_compression for encoded
    // JPEG/WebP output. The workflow node keeps a UI default for those formats,
    // so never let that stale default leak into a PNG request.
    if (typeof compression === "number" && outputFormat !== "png") request.output_compression = compression;
  }

  if (executorId === "video_generate") {
    if (typeof config.sound === "string") request.generateAudio = config.sound === "on";
    if (!firstNonEmptyString(request.resolution)) request.resolution = "720p";
    // Older workflow definitions used images[] for first/last frames. Keep
    // that convention readable while preferring the role-specific ports.
    const legacyImages = Array.isArray(inputs.images) ? inputs.images : undefined;
    const firstFrame = preferredMediaReferences(
      inputs["image.first_frame"],
      inputs.firstFrame,
      legacyImages ? legacyImages.slice(0, 1) : inputs.images,
      inputs.image,
    );
    const lastFrame = preferredMediaReferences(
      inputs["image.last_frame"],
      inputs.lastFrame,
      legacyImages ? legacyImages.slice(1, 2) : undefined,
    );
    const referenceMode = config.mode === "reference-to-video";
    const referenceImages = preferredMediaReferences(inputs["image.reference"], inputs.referenceImages, config.referenceImageUrls, config.referenceImages, ...(referenceMode ? [config.imageUrls] : []));
    const sourceVideo = preferredMediaReferences(inputs["video.source"], inputs.videos, inputs.video, ...(referenceMode ? [] : [config.sourceVideoUrl, config.videos, config.video]));
    const referenceVideos = preferredMediaReferences(inputs["video.reference"], inputs.referenceVideos, config.referenceVideoUrls, config.referenceVideos, config.videoUrls, ...(referenceMode ? [config.sourceVideoUrl] : []));
    const referenceAudios = preferredMediaReferences(inputs["audio.reference"], inputs.referenceAudios, config.referenceAudioUrls, config.referenceAudios, config.audioUrls, config.audioUrl);
    assertMaximum("image.first_frame", firstFrame, 1);
    assertMaximum("image.last_frame", lastFrame, 1);
    // Keep the shared input normalizer at the largest supported direct-provider
    // contract. The host applies the selected provider/model capability after
    // normalization (for example RunningHub H3 is stricter at 9/3/3, while
    // Wan 3 accepts 10 reference images and 5 reference videos/audio files).
    assertMaximum("image.reference", referenceImages, 10);
    assertMaximum("video.source", sourceVideo, 1);
    assertMaximum("video.reference", referenceVideos, 5);
    assertMaximum("audio.reference", referenceAudios, 5);
    const mode = firstNonEmptyString(config.mode) ?? "auto";
    if (mode === "first-last-frame" && (!firstFrame.length || !lastFrame.length)) throw new Error("workflow_media_role_required:first-last-frame");
    if (mode === "video-edit" && !sourceVideo.length) throw new Error("workflow_media_role_required:video.source");
    const firstFrameUrl = firstNonEmptyString(firstFrame[0]?.url, firstFrame[0]?.localPath, firstUrl(inputs.images), firstUrl(inputs.image), config.firstFrameUrl);
    const lastFrameUrl = firstNonEmptyString(lastFrame[0]?.url, lastFrame[0]?.localPath, secondUrl(inputs.images), config.lastFrameUrl);
    if (firstFrameUrl) request.firstFrameUrl = firstFrameUrl;
    if (lastFrameUrl) request.lastFrameUrl = lastFrameUrl;
    const referenceImageUrls = referenceImages.flatMap((reference) => reference.url ? [reference.url] : reference.localPath ? [reference.localPath] : []);
    const sourceVideoUrl = firstNonEmptyString(sourceVideo[0]?.url, sourceVideo[0]?.localPath);
    const referenceVideoUrls = referenceVideos.flatMap((reference) => reference.url ? [reference.url] : reference.localPath ? [reference.localPath] : []);
    const referenceAudioUrls = referenceAudios.flatMap((reference) => reference.url ? [reference.url] : reference.localPath ? [reference.localPath] : []);
    if (referenceImageUrls.length) request.referenceImageUrls = referenceImageUrls;
    if (sourceVideoUrl) request.sourceVideoUrl = sourceVideoUrl;
    if (referenceVideoUrls.length) request.referenceVideoUrls = referenceVideoUrls;
    if (referenceAudioUrls.length) request.referenceAudioUrls = referenceAudioUrls;
    const localMediaReferences = {
      firstFrame: firstFrame.filter((reference) => reference.localPath), lastFrame: lastFrame.filter((reference) => reference.localPath), referenceImages: referenceImages.filter((reference) => reference.localPath), sourceVideo: sourceVideo.filter((reference) => reference.localPath), referenceVideos: referenceVideos.filter((reference) => reference.localPath), referenceAudios: referenceAudios.filter((reference) => reference.localPath),
    };
    if (Object.values(localMediaReferences).some((references) => references.length)) request.localMediaReferences = localMediaReferences;
  }

  if (executorId === "digital_human") {
    const imageReferences = uniqueReferences(collectMediaReferences(inputs.images ?? inputs.image));
    const audioReferences = uniqueReferences(collectMediaReferences(inputs.audios ?? inputs.audio));
    const avatarImageUrl = firstNonEmptyString(config.avatarImageUrl, imageReferences[0]?.url);
    const audioUrl = firstNonEmptyString(config.audioUrl, audioReferences[0]?.url);
    if (avatarImageUrl) request.avatarImageUrl = avatarImageUrl;
    if (audioUrl) request.audioUrl = audioUrl;
    const localMediaReferences = {
      images: imageReferences.filter((reference) => reference.localPath),
      audios: audioReferences.filter((reference) => reference.localPath),
    };
    if (Object.values(localMediaReferences).some((references) => references.length)) request.localMediaReferences = localMediaReferences;
  }

  if (executorId === "music_generate") {
    request.kind = "music";
    request.featureId = "ai-music";
    const sourceAudioUrl = firstNonEmptyString(config.sourceAudioUrl, firstUrl(inputs.audios), firstUrl(inputs.audio));
    delete request.sourceAudioUrl;
    if (sourceAudioUrl) request.audio_url = sourceAudioUrl;
  }

  if (executorId === "voice_synthesis" || executorId === "audio_generate") {
    request.kind = firstNonEmptyString(config.kind) ?? "speech";
    const text = firstNonEmptyString(config.text, inputs.text, config.prompt);
    if (text) request.text = text;
    request.language_boost = firstNonEmptyString(config.languageBoost) ?? "auto";
    request.voice_setting = {
      voice_id: firstNonEmptyString(config.voiceId) ?? "English_Trustworth_Man",
      speed: Number(config.speed ?? 1),
      vol: Number(config.volume ?? 1),
      pitch: Number(config.pitch ?? 0),
    };
    request.audio_setting = { audio_sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 };
  }

  return request;
}
