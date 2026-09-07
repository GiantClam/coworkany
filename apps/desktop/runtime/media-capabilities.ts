export type VideoMediaCapabilityProfile = {
  readonly supportsFirstFrame: boolean;
  readonly supportsLastFrame: boolean;
  readonly supportsReferenceImages: boolean;
  readonly supportsSourceVideo: boolean;
  readonly supportsReferenceVideos: boolean;
  readonly supportsReferenceAudios: boolean;
  readonly supportsVideoEdit: boolean;
  readonly maxReferenceImages: number;
  readonly maxReferenceVideos: number;
  readonly maxReferenceAudios: number;
};

const NO_VIDEO_MEDIA: VideoMediaCapabilityProfile = {
  supportsFirstFrame: false,
  supportsLastFrame: false,
  supportsReferenceImages: false,
  supportsSourceVideo: false,
  supportsReferenceVideos: false,
  supportsReferenceAudios: false,
  supportsVideoEdit: false,
  maxReferenceImages: 0,
  maxReferenceVideos: 0,
  maxReferenceAudios: 0,
};

const FIRST_FRAME_VIDEO: VideoMediaCapabilityProfile = {
  ...NO_VIDEO_MEDIA,
  supportsFirstFrame: true,
};

const BAILIAN_VIDEO: VideoMediaCapabilityProfile = {
  ...FIRST_FRAME_VIDEO,
  supportsReferenceImages: true,
  supportsSourceVideo: true,
  supportsVideoEdit: true,
  maxReferenceImages: 3,
};

const BAILIAN_WAN3_VIDEO: VideoMediaCapabilityProfile = {
  ...BAILIAN_VIDEO,
  supportsLastFrame: true,
  supportsReferenceVideos: true,
  supportsReferenceAudios: true,
  maxReferenceImages: 10,
  maxReferenceVideos: 5,
  maxReferenceAudios: 5,
};

const RUNNINGHUB_H3_VIDEO: VideoMediaCapabilityProfile = {
  ...NO_VIDEO_MEDIA,
  // H3 consumes a first frame as the first item in imageUrls; it has no
  // separate first-frame request field.
  supportsFirstFrame: true,
  supportsReferenceImages: true,
  supportsReferenceVideos: true,
  supportsReferenceAudios: true,
  maxReferenceImages: 9,
  maxReferenceVideos: 3,
  maxReferenceAudios: 3,
};

/**
 * This is intentionally conservative. A model must opt into a role before
 * the host sends it; generic endpoint configuration alone is not a contract.
 */
export function resolveVideoMediaCapabilities(providerSource: string, _modelId?: string): VideoMediaCapabilityProfile {
  const source = providerSource.trim().toLowerCase();
  const model = (_modelId ?? "").trim().toLowerCase();
  // The generic HTTP/OpenAI-compatible adapter has historically accepted the
  // first-frame field, so keep that legacy workflow contract intact while
  // still rejecting the newer role-specific inputs until an adapter opts in.
  if (source.includes("bailian") || source.includes("dashscope")) return model.includes("wan3") ? BAILIAN_WAN3_VIDEO : BAILIAN_VIDEO;
  if (source.includes("runninghub") && model.includes("h3")) return RUNNINGHUB_H3_VIDEO;
  if (source.includes("minimax") || source.includes("openai-compatible")) return FIRST_FRAME_VIDEO;
  return NO_VIDEO_MEDIA;
}

export function assertVideoMediaCapability(profile: VideoMediaCapabilityProfile, input: Record<string, unknown>) {
  const has = (key: string) => Array.isArray(input[key]) ? input[key].length > 0 : typeof input[key] === "string" && Boolean(input[key].trim());
  const count = (key: string) => Array.isArray(input[key]) ? input[key].length : 0;
  if (has("firstFrameUrl") && !profile.supportsFirstFrame) throw new Error("provider_media_role_unsupported:image.first_frame");
  if (has("lastFrameUrl") && !profile.supportsLastFrame) throw new Error("provider_media_role_unsupported:image.last_frame");
  if (has("referenceImageUrls") && !profile.supportsReferenceImages) throw new Error("provider_media_role_unsupported:image.reference");
  if (count("referenceImageUrls") > profile.maxReferenceImages) throw new Error(`workflow_media_role_limit:image.reference:${profile.maxReferenceImages}`);
  if (has("sourceVideoUrl") && !profile.supportsSourceVideo) throw new Error("provider_media_role_unsupported:video.source");
  if (has("referenceVideoUrls") && !profile.supportsReferenceVideos) throw new Error("provider_media_role_unsupported:video.reference");
  if (count("referenceVideoUrls") > profile.maxReferenceVideos) throw new Error(`workflow_media_role_limit:video.reference:${profile.maxReferenceVideos}`);
  if (has("referenceAudioUrls") && !profile.supportsReferenceAudios) throw new Error("provider_media_role_unsupported:audio.reference");
  if (count("referenceAudioUrls") > profile.maxReferenceAudios) throw new Error(`workflow_media_role_limit:audio.reference:${profile.maxReferenceAudios}`);
  if (input.mode === "video-edit" && !profile.supportsVideoEdit) throw new Error("provider_media_role_unsupported:video.edit");
}

export function supportsVideoMediaRole(profile: VideoMediaCapabilityProfile, role: string | undefined) {
  return !role || role === "text.prompt"
    ? true
    : role === "image.first_frame"
      ? profile.supportsFirstFrame
      : role === "image.last_frame"
        ? profile.supportsLastFrame
        : role === "image.reference"
          ? profile.supportsReferenceImages
          : role === "video.source"
            ? profile.supportsSourceVideo
            : role === "video.reference"
              ? profile.supportsReferenceVideos
              : role === "audio.reference"
                ? profile.supportsReferenceAudios
                : true;
}
