export type WorkbenchMediaFeatureId =
  | "ai-music"
  | "audio-generate"
  | "voice-clone"
  | "voice-synthesis"
  | "text-to-video"
  | "image-to-video"
  | "reference-to-video"
  | "video-edit"
  | "digital-human"
  | "video-enhance";

export type WorkbenchMediaField = {
  id: string;
  label: string;
  type: "text" | "url" | "textarea" | "number" | "select";
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
};

export type WorkbenchMediaFeature = {
  id: WorkbenchMediaFeatureId;
  group: "audio" | "video";
  title: string;
  summary: string;
  submitLabel: string;
  fields: WorkbenchMediaField[];
};

const IMAGE_RATIO_OPTIONS = ["1:1", "4:5", "3:4", "4:3", "16:9", "9:16"];
const IMAGE_SIZE_OPTIONS = ["auto", "1024x1024", "1536x1024", "1024x1536", "2048x2048"];
const BAILIAN_IMAGE_SIZE_OPTIONS = ["auto", "1024*1024", "1536*1024", "1024*1536", "2048*2048"];

function imageField(id: string, label: string, type: WorkbenchMediaField["type"], extra: Partial<WorkbenchMediaField> = {}): WorkbenchMediaField {
  return { id, label, type, ...extra };
}

/**
 * Resolve the image node's provider-specific controls from the same model
 * contract used by the media workspace. Inputs remain role-based ports; this
 * function only describes scalar generation parameters.
 */
export function resolveWorkbenchImageParameterFields(selectedModel?: string | null, selectedProvider?: string | null): readonly WorkbenchMediaField[] {
  const model = (selectedModel || "").trim().toLowerCase();
  const provider = (selectedProvider || "").trim().toLowerCase();
  const source = `${provider}/${model}`;
  const qwenImage = model.includes("qwen-image");
  const qwenImageEdit = qwenImage && /(?:-edit|image-to-image|img2img)/iu.test(model);
  const qwenImage27 = qwenImage && model.includes("2.7");
  if (qwenImage || (source.includes("bailian") && !model)) {
    const supportsAdvanced = !qwenImageEdit && !qwenImage27;
    return [
      imageField("imageSize", "尺寸", "select", { defaultValue: qwenImageEdit ? "auto" : "1024*1024", options: (qwenImage27 || qwenImageEdit ? ["auto", "1024*1024", "2048*2048"] : BAILIAN_IMAGE_SIZE_OPTIONS).map((value) => ({ value, label: value })) }),
      ...(supportsAdvanced || qwenImageEdit ? [imageField("imageNegativePrompt", "反向提示词", "textarea")] : []),
      ...(supportsAdvanced || qwenImageEdit ? [imageField("imageCandidateCount", "生成数量", "number", { defaultValue: "1", min: 1, max: 6 })] : []),
      ...(supportsAdvanced ? [imageField("imagePromptExtend", "提示词扩写", "select", { defaultValue: "true", options: [{ value: "true", label: "开启" }, { value: "false", label: "关闭" }] }), imageField("imageWatermark", "水印", "select", { defaultValue: "false", options: [{ value: "false", label: "关闭" }, { value: "true", label: "开启" }] }), imageField("imageSeed", "随机种子", "number", { defaultValue: "0", min: 0, max: 2147483647 })] : []),
    ];
  }
  if (source.includes("google") || source.includes("gemini") || model.includes("nanobanana") || model.includes("gemini-2.5-flash-image")) {
    return [
      imageField("imageSize", "画面比例", "select", { defaultValue: "1:1", options: IMAGE_RATIO_OPTIONS.map((value) => ({ value, label: value })) }),
      imageField("imageResolution", "分辨率", "select", { defaultValue: "2K", options: ["1K", "2K", "4K"].map((value) => ({ value, label: value })) }),
    ];
  }
  if (source.includes("runninghub") || model.includes("seedream")) {
    return [
      imageField("imageSize", "尺寸", "select", { defaultValue: "1024x1024", options: ["1024x1024", "1536x1024"].map((value) => ({ value, label: value })) }),
      ...(model.includes("image-to-image") || model.includes("img2img") ? [imageField("inputImageUrl", "输入图片地址", "url", { required: true })] : []),
    ];
  }
  if (source.includes("openai") || source.includes("pptoken") || model.includes("gpt-image")) {
    return [
      imageField("imageSize", "尺寸", "select", { defaultValue: "1024x1024", options: IMAGE_SIZE_OPTIONS.map((value) => ({ value, label: value })) }),
      imageField("imageQuality", "质量", "select", { defaultValue: "auto", options: ["auto", "low", "medium", "high"].map((value) => ({ value, label: value })) }),
      imageField("imageBackground", "背景", "select", { defaultValue: "auto", options: ["auto", "transparent", "opaque"].map((value) => ({ value, label: value })) }),
      imageField("imageOutputFormat", "输出格式", "select", { defaultValue: "png", options: ["png", "jpeg", "webp"].map((value) => ({ value, label: value })) }),
      imageField("imageOutputCompression", "输出压缩", "number", { defaultValue: "80", min: 0, max: 100 }),
      imageField("imageModeration", "内容审核", "select", { defaultValue: "auto", options: ["auto", "low"].map((value) => ({ value, label: value })) }),
      imageField("imageCandidateCount", "生成数量", "number", { defaultValue: "1", min: 1, max: 9 }),
    ];
  }
  return [
    imageField("imageQuality", "质量", "select", { defaultValue: "standard", options: ["standard", "hd"].map((value) => ({ value, label: value })) }),
    imageField("imageSize", "尺寸", "select", { defaultValue: "1024x1024", options: IMAGE_SIZE_OPTIONS.filter((value) => value !== "auto").map((value) => ({ value, label: value })) }),
    imageField("imageCandidateCount", "生成数量", "number", { defaultValue: "1", min: 1, max: 4 }),
  ];
}

/** Shared feature/field contract for the cloud media workspace and Tauri adapter. */
export const WORKBENCH_MEDIA_FEATURES: readonly WorkbenchMediaFeature[] = [
  { id: "ai-music", group: "audio", title: "AI音乐", summary: "生成歌曲与配乐，支持手填歌词或 AI 自动写词。", submitLabel: "生成音频", fields: [
    { id: "stylePrompt", label: "风格 / 情绪 / 场景", type: "textarea", placeholder: "例如：独立电子流行，适合 AI 产品发布片头。" },
    { id: "lyricsSource", label: "歌词来源", type: "select", defaultValue: "manual", options: [{ value: "manual", label: "手动填写" }, { value: "ai_generate", label: "AI 自动生成" }] },
    { id: "lyrics", label: "歌词", type: "textarea", placeholder: "手动填写歌词，或在结果区回显 AI 生成歌词。" },
    { id: "lyricsPrompt", label: "AI 写词提示", type: "textarea", placeholder: "例如：写一首关于新品牌发布夜的中文流行歌。" },
    { id: "sourceAudioUrl", label: "翻唱源音频 URL", type: "url", placeholder: "仅 music-cover 需要：原曲或参考音频的可访问 URL" },
    { id: "model", label: "模型", type: "select", defaultValue: "music-2.6", options: [
      { value: "music-2.6", label: "Music 2.6" }, { value: "music-2.6-free", label: "Music 2.6 Free" }, { value: "music-cover", label: "Music Cover" }, { value: "music-cover-free", label: "Music Cover Free" },
    ] },
  ] },
  { id: "audio-generate", group: "audio", title: "通用音频", summary: "生成环境音、音效和其他通用音频内容。", submitLabel: "生成音频", fields: [
    { id: "prompt", label: "音频提示词", type: "textarea", placeholder: "例如：生成一段适合科技产品发布会转场的短音效。" },
    { id: "duration", label: "时长（秒）", type: "number", defaultValue: "8" },
    { id: "format", label: "格式", type: "select", defaultValue: "mp3", options: [{ value: "mp3", label: "MP3" }, { value: "wav", label: "WAV" }] },
  ] },
  { id: "voice-clone", group: "audio", title: "声音克隆", summary: "上传或录制参考音频，复刻音色并生成试听结果。", submitLabel: "复刻音色", fields: [
    { id: "voiceId", label: "新音色 ID", type: "text", placeholder: "留空则自动生成，例如 voice_brand_host" },
    { id: "previewText", label: "试听文本", type: "textarea", placeholder: "例如：欢迎来到 CoworkAny 新品发布会。" },
    { id: "promptText", label: "示例音频文本", type: "text", placeholder: "上传示例音频时可填写。" },
    { id: "needNoiseReduction", label: "降噪", type: "select", defaultValue: "false", options: [{ value: "false", label: "关闭" }, { value: "true", label: "开启" }] },
  ] },
  { id: "voice-synthesis", group: "audio", title: "声音合成", summary: "把长文本提交为异步语音任务，查询状态后下载音频。", submitLabel: "合成语音", fields: [
    { id: "prompt", label: "文本内容", type: "textarea", placeholder: "输入需要合成的完整文本" },
    { id: "voiceId", label: "音色", type: "text", placeholder: "从可用音色库选择" },
    { id: "model", label: "模型", type: "select", defaultValue: "speech-2.8-hd", options: [
      { value: "speech-2.8-hd", label: "Speech 2.8 HD" }, { value: "speech-2.8-turbo", label: "Speech 2.8 Turbo" },
      { value: "speech-2.6-hd", label: "Speech 2.6 HD" }, { value: "speech-2.6-turbo", label: "Speech 2.6 Turbo" },
      { value: "speech-02-hd", label: "Speech 02 HD" }, { value: "speech-02-turbo", label: "Speech 02 Turbo" },
    ] },
    { id: "languageBoost", label: "语言增强", type: "select", defaultValue: "auto", options: [{ value: "auto", label: "自动" }, { value: "Chinese", label: "中文" }, { value: "English", label: "英文" }] },
    { id: "speed", label: "语速", type: "number", defaultValue: "1" }, { id: "volume", label: "音量", type: "number", defaultValue: "1" }, { id: "pitch", label: "音高", type: "number", defaultValue: "1" },
  ] },
  { id: "text-to-video", group: "video", title: "文生视频", summary: "直接输入提示词生成视频。", submitLabel: "生成视频", fields: [{ id: "model", label: "模型", type: "select", defaultValue: "minimax/video-01", options: [{ value: "minimax/video-01", label: "MiniMax Hailuo" }, { value: "bailian/video", label: "Aliyun Bailian" }] }, { id: "prompt", label: "视频提示词", type: "textarea", placeholder: "描述镜头、人物动作、风格和时长" }] },
  { id: "image-to-video", group: "video", title: "图生视频", summary: "上传或选择首帧图片生成视频。", submitLabel: "生成视频", fields: [{ id: "model", label: "模型", type: "select", defaultValue: "minimax/video-01-live", options: [{ value: "minimax/video-01-live", label: "MiniMax Hailuo Image-to-Video" }] }, { id: "firstFrameUrl", label: "首帧图片", type: "url", placeholder: "粘贴本地素材相对路径或 URL" }, { id: "prompt", label: "动作提示", type: "textarea", placeholder: "描述图片中的主体如何运动" }] },
  { id: "reference-to-video", group: "video", title: "参考生视频", summary: "使用一至多张参考图保持主体特征。", submitLabel: "生成视频", fields: [{ id: "model", label: "模型", type: "select", defaultValue: "minimax/video-01-live", options: [{ value: "minimax/video-01-live", label: "MiniMax Hailuo Reference" }] }, { id: "referenceImageUrls", label: "参考图片", type: "url", placeholder: "粘贴本地素材路径，多个路径用逗号分隔" }, { id: "prompt", label: "场景提示", type: "textarea", placeholder: "描述参考主体在镜头中的动作" }] },
  { id: "video-edit", group: "video", title: "视频编辑", summary: "上传视频并用文字指令完成风格转换或元素替换。", submitLabel: "编辑视频", fields: [{ id: "model", label: "模型", type: "select", defaultValue: "minimax/video-edit", options: [{ value: "minimax/video-edit", label: "MiniMax Video Edit" }] }, { id: "sourceVideoUrl", label: "源视频", type: "url", placeholder: "粘贴本地视频路径或 URL" }, { id: "prompt", label: "编辑指令", type: "textarea", placeholder: "例如：把背景替换为夜景城市" }] },
  { id: "digital-human", group: "video", title: "口播数字人", summary: "支持上传或选择音频、人物图，也支持只填文案走 TTS 驱动。", submitLabel: "生成口播视频", fields: [{ id: "audioUrl", label: "音频 URL", type: "url", placeholder: "上传音频后会自动填入，也可以粘贴素材库音频地址" }, { id: "avatarImageUrl", label: "人物图片 URL", type: "url", placeholder: "上传图片后会自动填入，也可以粘贴素材库图片地址" }, { id: "script", label: "口播文案", type: "textarea", placeholder: "未上传音频时，这段文案会走 TTS 合成。" }, { id: "prompt", label: "场景提示", type: "textarea", placeholder: "例如：模特正在做产品展示，进行电商直播带货" }, { id: "seed", label: "Seed", type: "number", defaultValue: "-1" }] },
  { id: "video-enhance", group: "video", title: "视频高清化", summary: "上传或选择源视频，执行视频修复和高清化。", submitLabel: "开始高清化", fields: [{ id: "sourceVideoUrl", label: "源视频 URL", type: "url", placeholder: "上传视频后会自动填入，也可以粘贴素材库视频地址" }, { id: "prompt", label: "增强目标", type: "textarea", placeholder: "例如：提升细节、修复压缩模糊、强化人物边缘" }, { id: "durationLimit", label: "处理时长上限（秒）", type: "number", defaultValue: "10" }, { id: "seed", label: "Seed", type: "number", defaultValue: "-1" }] },
] as const;

const videoFeatureIds = new Set<WorkbenchMediaFeatureId>(["text-to-video", "image-to-video", "reference-to-video", "video-edit"]);

const boolOptions = [{ value: "true", label: "开启" }, { value: "false", label: "关闭" }];
const ratioOptions = ["adaptive", "16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21"].map((value) => ({ value, label: value }));
const resolutionOptions = [{ value: "720P", label: "720P" }, { value: "1080P", label: "1080P" }];

function field(id: string, label: string, type: WorkbenchMediaField["type"], extra: Partial<WorkbenchMediaField> = {}): WorkbenchMediaField {
  return { id, label, type, ...extra };
}

/**
 * The cloud capability workspace resolves video fields from the selected
 * model's parameter schema. Keep the desktop surface on the same contract;
 * provider-specific fields are intentionally derived at render time.
 */
export function resolveWorkbenchMediaFeature(feature: WorkbenchMediaFeature, selectedModel?: string | null, selectedProvider?: string | null): WorkbenchMediaFeature {
  if (feature.group !== "video" || !videoFeatureIds.has(feature.id)) return feature;
  const modelField = feature.fields.find((item) => item.id === "model");
  if (!modelField) return feature;
  const model = (selectedModel || modelField.defaultValue || "").toLowerCase();
  const provider = (selectedProvider || "").toLowerCase();
  const providerModel = `${provider}/${model}`;
  const imageToVideo = feature.id === "image-to-video";
  const referenceToVideo = feature.id === "reference-to-video";
  const edit = feature.id === "video-edit";
  let runtimeFields: WorkbenchMediaField[];

  if (model.includes("grok-imagine-video")) {
    runtimeFields = [
      field("prompt", "视频提示词", "textarea", { required: true }),
      field("duration", "时长", "number", { defaultValue: "3", min: 1, max: 15, step: 1 }),
      field("resolution", "分辨率", "select", { defaultValue: "720p", options: [{ value: "480p", label: "480p" }, { value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }] }),
      field("ratio", "画面比例", "select", { defaultValue: "16:9", options: ratioOptions.filter((option) => option.value !== "adaptive") }),
    ];
  } else if (model.includes("seedance")) {
    const seedanceProOrMini = model.includes("pro") || model.includes("mini");
    runtimeFields = [
      ...(imageToVideo ? [field("firstFrameUrl", "首帧图片地址", "url", { required: true })] : []),
      ...(imageToVideo ? [field("lastFrameUrl", "尾帧图片地址", "url")] : []),
      ...(referenceToVideo ? [field("referenceImageUrls", "参考图片地址", "textarea", { required: true })] : []),
      ...(edit ? [field("sourceVideoUrl", "源视频地址", "url", { required: true }), field("referenceImageUrls", "参考图片地址", "textarea")] : []),
      field("prompt", edit ? "编辑指令" : "视频提示词", "textarea", { required: !imageToVideo && !edit }),
      field("duration", "时长", "select", { defaultValue: "5", options: [{ value: "5", label: "5秒" }, { value: "10", label: "10秒" }] }),
      field("resolution", "分辨率", "select", { defaultValue: "720p", options: [{ value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }] }),
      field("ratio", "画面比例", "select", { defaultValue: "adaptive", options: ratioOptions }),
      ...(edit ? [field("audioSetting", "音频设置", "select", { defaultValue: "auto", options: [{ value: "auto", label: "自动" }, { value: "origin", label: "原始音频" }] })] : [field("generateAudio", "生成音频", "select", { defaultValue: "true", options: boolOptions }), ...(imageToVideo ? [field("realPersonMode", "真人模式", "select", { defaultValue: "true", options: boolOptions })] : [])]),
      ...(seedanceProOrMini ? [field("webSearch", "联网搜索", "select", { defaultValue: "false", options: boolOptions }), field("returnLastFrame", "返回尾帧", "select", { defaultValue: "false", options: boolOptions })] : []),
      field("seed", "Seed", "number", { defaultValue: "-1", min: -1 }),
    ];
  } else if (model.includes("h3") || model.includes("minimax-h3")) {
    runtimeFields = [
      ...(imageToVideo ? [field("firstFrameUrl", "首帧图片地址", "url", { required: true }), field("imageUrls", "附加图片地址", "textarea")] : []),
      ...(referenceToVideo ? [field("referenceImageUrls", "参考图片地址", "textarea"), field("videoUrls", "参考视频地址", "textarea"), field("sourceVideoUrl", "参考视频地址", "url"), field("audioUrls", "参考音频地址", "textarea"), field("audioUrl", "参考音频地址", "url")] : []),
      field("prompt", "视频提示词", "textarea", { required: true }),
      field("resolution", "分辨率", "select", { defaultValue: "2K", options: [{ value: "2K", label: "2K" }] }),
      field("duration", "时长", "select", { defaultValue: "5", options: ["5", "6", "8", "10", "12", "15"].map((value) => ({ value, label: `${value}秒` })) }),
      field("ratio", "画面比例", "select", { defaultValue: "adaptive", options: ratioOptions }),
    ];
  } else if ((model.includes("minimax") || model.includes("video-01")) && !referenceToVideo && !edit) {
    runtimeFields = [
      ...(imageToVideo ? [field("firstFrameUrl", "首帧图片地址", "url", { required: true })] : []),
      ...(referenceToVideo ? [field("referenceImageUrls", "参考图片地址", "textarea", { required: true })] : []),
      ...(edit ? [field("sourceVideoUrl", "源视频地址", "url", { required: true }), field("referenceImageUrls", "参考图片地址", "textarea")] : []),
      field("prompt", edit ? "编辑指令" : "视频提示词", "textarea", { required: !imageToVideo || referenceToVideo || edit }),
      field("duration", "时长", "select", { defaultValue: "6", options: [{ value: "6", label: "6秒" }, { value: "10", label: "10秒" }] }),
      field("resolution", "分辨率", "select", { defaultValue: "768P", options: [{ value: "768P", label: "768P" }, { value: "1080P", label: "1080P" }] }),
      ...(edit ? [field("watermark", "水印", "select", { defaultValue: "true", options: boolOptions }), field("audioSetting", "音频设置", "select", { defaultValue: "auto", options: [{ value: "auto", label: "自动" }, { value: "origin", label: "原始音频" }] })] : []),
      ...(referenceToVideo ? [field("ratio", "画面比例", "select", { defaultValue: "adaptive", options: ratioOptions })] : []),
      ...(edit ? [field("seed", "Seed", "number", { defaultValue: "0", min: 0 })] : []),
    ];
  } else if (model.includes("happyhorse") || model.includes("bailian:video") || providerModel.includes("bailian")) {
    const editFields = edit ? [
      field("sourceVideoUrl", "源视频地址", "url", { required: true }),
      field("referenceImageUrls", "参考图片地址", "textarea"),
      field("prompt", "编辑指令", "textarea", { required: true }),
      field("resolution", "分辨率", "select", { defaultValue: "1080P", options: resolutionOptions }),
      field("watermark", "水印", "select", { defaultValue: "true", options: boolOptions }),
      field("audioSetting", "音频设置", "select", { defaultValue: "auto", options: [{ value: "auto", label: "自动" }, { value: "origin", label: "原始音频" }] }),
      field("seed", "Seed", "number", { defaultValue: "0", min: 0 }),
    ] : [];
    runtimeFields = [
      ...editFields,
      ...(editFields.length ? [] : [
        ...(imageToVideo ? [field("firstFrameUrl", "首帧图片地址", "url", { required: true })] : []),
        ...(referenceToVideo ? [field("referenceImageUrls", "参考图片地址", "textarea", { required: true })] : []),
        field("prompt", "视频提示词", "textarea", { required: !imageToVideo }),
        field("resolution", "分辨率", "select", { defaultValue: "1080P", options: resolutionOptions }),
        field("ratio", "画面比例", "select", { defaultValue: "16:9", options: ratioOptions.filter((option) => option.value !== "adaptive") }),
        field("duration", "时长", "number", { defaultValue: "5", min: 3, max: 15, step: 1 }),
        field("watermark", "水印", "select", { defaultValue: "true", options: boolOptions }),
        field("seed", "Seed", "number", { defaultValue: "0", min: 0 }),
      ]),
    ];
  } else {
    return feature;
  }

  return { ...feature, fields: [modelField, ...runtimeFields] };
}
