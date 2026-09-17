import { hashWorkflowDefinition, type WorkflowDefinitionEnvelope } from "@coworkany/workflow-core";
import type { DesktopProviderConfig } from "./provider-config";

type DesktopVideoProvider = {
  readonly id: string;
  readonly model?: string;
  readonly baseUrl?: string;
};

type DesktopLocale = "zh" | "en";

function localized(locale: DesktopLocale, zh: string, en: string) {
  return locale === "zh" ? zh : en;
}

function videoNodeConfig(prompt: string, provider: DesktopVideoProvider, duration: string, sound: "on" | "off") {
  return {
    prompt,
    selectedProviderId: provider.id,
    selectedModelId: provider.model ?? "",
    provider: provider.id,
    model: provider.model ?? "",
    baseUrl: provider.baseUrl,
    mode: "auto",
    duration,
    ratio: "9:16",
    sound,
  };
}

/**
 * The desktop template is intentionally built from local canvas primitives.
 * It remains usable offline while the final MP4 assembly is handled by the
 * local FFmpeg-backed video_process node.
 */
export function buildProductIntroVideoWorkflowDefinition(provider: DesktopVideoProvider, locale: DesktopLocale = "zh"): WorkflowDefinitionEnvelope {
  const prompt = localized(locale, "产品介绍视频：请根据用户提供的产品信息和素材完成视频分镜。", "Product intro video: use the supplied product brief and assets to create the storyboard.");
  const definition: WorkflowDefinitionEnvelope = {
    schemaVersion: 2,
    revision: 1,
    definitionHash: "",
    metadata: {
      templateKey: "product-intro-video",
      description: localized(locale, "前 5 秒人物介绍与操作引导，中间 5 秒产品操作，最后 3 秒统一片尾。", "First 5s: person intro and guidance; next 5s: product operation; final 3s: unified outro."),
      status: "draft",
    },
    nodes: [
      { nodeKey: "input", type: "text_input", nodeVersion: 1, title: localized(locale, "产品信息", "Product brief"), positionX: 0, positionY: 220, config: { text: prompt } },
      { nodeKey: "person-assets", type: "upload", nodeVersion: 1, title: localized(locale, "人物素材", "Person assets"), positionX: 0, positionY: 0, config: { uploadedFiles: [], referencedArtifactIds: [] } },
      { nodeKey: "product-assets", type: "upload", nodeVersion: 1, title: localized(locale, "产品操作素材", "Product demo assets"), positionX: 0, positionY: 440, config: { uploadedFiles: [], referencedArtifactIds: [] } },
      { nodeKey: "brand-assets", type: "upload", nodeVersion: 1, title: localized(locale, "品牌片尾素材", "Brand outro assets"), positionX: 0, positionY: 660, config: { uploadedFiles: [], referencedArtifactIds: [] } },
      { nodeKey: "person-intro", type: "video_generate", nodeVersion: 1, title: localized(locale, "人物介绍 · 5 秒", "Person intro · 5s"), positionX: 408, positionY: 0, config: videoNodeConfig(localized(locale, "0–5 秒：人物介绍与产品操作引导，使用人物素材，动作清晰，配合字幕。", "0–5s: introduce the person and guide the product action with clear movement and captions."), provider, "5", "on") },
      { nodeKey: "product-demo", type: "video_generate", nodeVersion: 1, title: localized(locale, "产品操作 · 5 秒", "Product demo · 5s"), positionX: 408, positionY: 440, config: videoNodeConfig(localized(locale, "5–10 秒：展示产品核心操作流程，严格依据提供的产品素材，不虚构功能。", "5–10s: show the core product operation using only supplied product assets; do not invent features."), provider, "5", "off") },
      { nodeKey: "outro", type: "video_generate", nodeVersion: 1, title: localized(locale, "统一片尾 · 3 秒", "Unified outro · 3s"), positionX: 816, positionY: 220, config: videoNodeConfig(localized(locale, "10–13 秒：使用统一品牌片尾，展示品牌标识和行动号召。", "10–13s: use the unified branded outro with the brand mark and call to action."), provider, "3", "off") },
      { nodeKey: "video-stitch", type: "video_process", nodeVersion: 1, title: localized(locale, "视频拼接 · 默认硬切", "Video stitch · Default cut"), positionX: 816, positionY: 520, config: { operation: "stitch", transition: "cut", transitionDurationMs: 300, ratio: "9:16", width: 1080, height: 1920, fps: 30, outputFormat: "mp4" } },
      { nodeKey: "output", type: "output", nodeVersion: 1, title: localized(locale, "视频结果", "Video result"), positionX: 1224, positionY: 220, config: { displayName: localized(locale, "产品介绍视频", "Product intro video"), allowEmpty: false, requireAllSucceeded: true } },
      { nodeKey: "asset-library", type: "product_store", nodeVersion: 1, title: localized(locale, "保存到资产库", "Save to Asset Library"), positionX: 1632, positionY: 220, config: { title: localized(locale, "产品介绍视频", "Product intro video"), fileName: "product-intro-video.mp4" } },
    ],
    edges: [
      { edgeKey: "brief-person-intro", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "person-intro", targetPortId: "text" },
      { edgeKey: "brief-product-demo", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "product-demo", targetPortId: "text" },
      { edgeKey: "brief-outro", sourceNodeKey: "input", sourcePortId: "text", targetNodeKey: "outro", targetPortId: "text" },
      { edgeKey: "person-assets-person-intro", sourceNodeKey: "person-assets", sourcePortId: "image", targetNodeKey: "person-intro", targetPortId: "images" },
      { edgeKey: "product-assets-product-demo", sourceNodeKey: "product-assets", sourcePortId: "video", targetNodeKey: "product-demo", targetPortId: "videos" },
      { edgeKey: "brand-assets-outro", sourceNodeKey: "brand-assets", sourcePortId: "image", targetNodeKey: "outro", targetPortId: "images" },
      { edgeKey: "person-intro-stitch", sourceNodeKey: "person-intro", sourcePortId: "video", targetNodeKey: "video-stitch", targetPortId: "videos" },
      { edgeKey: "product-demo-stitch", sourceNodeKey: "product-demo", sourcePortId: "video", targetNodeKey: "video-stitch", targetPortId: "videos" },
      { edgeKey: "outro-stitch", sourceNodeKey: "outro", sourcePortId: "video", targetNodeKey: "video-stitch", targetPortId: "videos" },
      { edgeKey: "video-stitch-output", sourceNodeKey: "video-stitch", sourcePortId: "video", targetNodeKey: "output", targetPortId: "videos" },
      { edgeKey: "output-asset-library", sourceNodeKey: "output", sourcePortId: "videos", targetNodeKey: "asset-library", targetPortId: "videos" },
    ],
  };
  return { ...definition, definitionHash: hashWorkflowDefinition(definition) };
}

type TemplateProvider = Pick<DesktopProviderConfig, "id" | "model" | "baseUrl">;

function providerConfig(provider: TemplateProvider) {
  return {
    selectedProviderId: provider.id ?? "",
    selectedModelId: provider.model ?? "",
    provider: provider.id ?? "",
    model: provider.model ?? "",
    ...(provider.baseUrl ? { baseUrl: provider.baseUrl } : {}),
  };
}

/** Builds a local image replacement, ASR, subtitle, and FFmpeg composition workflow. */
export function buildCharacterSwapVideoWorkflowDefinition(
  providers: { readonly image: TemplateProvider; readonly audio: TemplateProvider; readonly video?: TemplateProvider },
  locale: "zh" | "en" = "zh",
): WorkflowDefinitionEnvelope {
  const copy = locale === "en"
    ? {
      input: "Replacement and subtitle instructions", reference: "Reference image", character: "Character image", audio: "Audio track", replace: "Replace character in reference", asr: "ASR subtitles", subtitle: "Subtitle file", video: "Compose subtitled video", output: "Final outputs", store: "Save final artifacts", prompt: "Replace the person in the reference image with the person from the character image. Preserve the reference background, composition, lighting, and style.",
    }
    : {
      input: "替换与字幕说明", reference: "参考图", character: "人物图", audio: "音频文件", replace: "替换参考图中的人物", asr: "ASR 转字幕", subtitle: "字幕文件", video: "合成带字幕视频", output: "最终输出", store: "保存最终产物", prompt: "将人物图中的人物替换到参考图中，保留参考图的背景、构图、光影和整体风格。",
    };
  const image = providerConfig(providers.image);
  const audio = providerConfig(providers.audio);
  const definition: WorkflowDefinitionEnvelope = {
    schemaVersion: 2,
    revision: 1,
    definitionHash: "",
    nodes: [
      { nodeKey: "prompt", type: "text_input", nodeVersion: 1, title: copy.input, positionX: 0, positionY: 0, config: { text: copy.prompt } },
      { nodeKey: "reference-image", type: "upload", nodeVersion: 1, title: copy.reference, positionX: 0, positionY: 360, config: { uploadedFiles: [], referencedArtifactIds: [] } },
      { nodeKey: "character-image", type: "upload", nodeVersion: 1, title: copy.character, positionX: 0, positionY: 720, config: { uploadedFiles: [], referencedArtifactIds: [] } },
      { nodeKey: "audio", type: "upload", nodeVersion: 1, title: copy.audio, positionX: 0, positionY: 1080, config: { uploadedFiles: [], referencedArtifactIds: [] } },
      { nodeKey: "replace", type: "image_generate", nodeVersion: 1, title: copy.replace, positionX: 480, positionY: 260, config: { ...image, prompt: copy.prompt, featureId: "image-edit", mode: "image-edit", requiresCharacterImageBindings: true } },
      { nodeKey: "asr", type: "agent_execute", nodeVersion: 1, title: copy.asr, positionX: 480, positionY: 900, config: { ...audio, operation: "audio_transcription", prompt: "将音频转为带时间戳的 SRT 字幕文本。" } },
      { nodeKey: "subtitle", type: "file_create", nodeVersion: 1, title: copy.subtitle, positionX: 900, positionY: 900, config: { fileName: "subtitles.srt", fileFormat: "srt" } },
      { nodeKey: "video", type: "video_compose", nodeVersion: 1, title: copy.video, positionX: 900, positionY: 260, config: { outputFormat: "mp4", subtitleMode: "burn_in", fitMode: "contain" } },
      { nodeKey: "output", type: "output", nodeVersion: 1, title: copy.output, positionX: 1360, positionY: 420, config: { displayName: copy.output, allowEmpty: false, requireAllSucceeded: true } },
      { nodeKey: "store", type: "product_store", nodeVersion: 1, title: copy.store, positionX: 1780, positionY: 420, config: { fileName: "character-swap-video.md", persistToWorkLibrary: true, persistToKnowledgeBase: false } },
    ],
    edges: [
      { edgeKey: "prompt-replace", sourceNodeKey: "prompt", sourcePortId: "text", targetNodeKey: "replace", targetPortId: "text" },
      { edgeKey: "reference-replace", sourceNodeKey: "reference-image", sourcePortId: "image", targetNodeKey: "replace", targetPortId: "referenceImage" },
      { edgeKey: "character-replace", sourceNodeKey: "character-image", sourcePortId: "image", targetNodeKey: "replace", targetPortId: "characterImage" },
      { edgeKey: "audio-asr", sourceNodeKey: "audio", sourcePortId: "audio", targetNodeKey: "asr", targetPortId: "audio" },
      { edgeKey: "replace-video", sourceNodeKey: "replace", sourcePortId: "image", targetNodeKey: "video", targetPortId: "coverImage" },
      { edgeKey: "audio-video", sourceNodeKey: "audio", sourcePortId: "audio", targetNodeKey: "video", targetPortId: "audio" },
      { edgeKey: "asr-subtitle", sourceNodeKey: "asr", sourcePortId: "text", targetNodeKey: "subtitle", targetPortId: "text" },
      { edgeKey: "subtitle-video", sourceNodeKey: "subtitle", sourcePortId: "asset", targetNodeKey: "video", targetPortId: "subtitle" },
      { edgeKey: "video-output", sourceNodeKey: "video", sourcePortId: "video", targetNodeKey: "output", targetPortId: "videos" },
      { edgeKey: "subtitle-output", sourceNodeKey: "subtitle", sourcePortId: "asset", targetNodeKey: "output", targetPortId: "assets" },
      { edgeKey: "asr-output", sourceNodeKey: "asr", sourcePortId: "text", targetNodeKey: "output", targetPortId: "text" },
      { edgeKey: "video-store", sourceNodeKey: "video", sourcePortId: "video", targetNodeKey: "store", targetPortId: "videos" },
      { edgeKey: "subtitle-store", sourceNodeKey: "subtitle", sourcePortId: "asset", targetNodeKey: "store", targetPortId: "assets" },
      { edgeKey: "audio-store", sourceNodeKey: "audio", sourcePortId: "audio", targetNodeKey: "store", targetPortId: "audios" },
    ],
  };
  return { ...definition, definitionHash: hashWorkflowDefinition(definition) };
}
