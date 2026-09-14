/**
 * Canonical Provider and model directory shared by the online governance UI
 * and the desktop settings surface. Built-in platforms expose governed model
 * IDs; OpenAI-compatible entries intentionally keep their model list empty.
 */
export type WorkbenchProviderCategory = "text_generation" | "image_generation" | "video_generation" | "audio_generation";

export type WorkbenchProviderDescriptor = {
  readonly providerId: string;
  readonly providerLabel: string;
  readonly integrationLabel: string;
  readonly models: readonly string[];
};

export const WORKBENCH_PROVIDER_CATALOG: Readonly<Record<WorkbenchProviderCategory, readonly WorkbenchProviderDescriptor[]>> = {
  text_generation: [
    { providerId: "siliconflow", providerLabel: "硅基流动", integrationLabel: "SiliconFlow API", models: ["deepseek-ai/DeepSeek-V3", "Qwen/Qwen2.5-72B-Instruct"] },
    { providerId: "openrouter", providerLabel: "OpenRouter", integrationLabel: "OpenRouter API", models: ["x-ai/grok-4.5"] },
    { providerId: "openai_compatible", providerLabel: "OpenAI Compatible", integrationLabel: "Compatible API", models: [] },
    { providerId: "qwen_official", providerLabel: "Qwen", integrationLabel: "Official API", models: ["qwen-plus", "qwen-max", "qwen-turbo"] },
    { providerId: "minimax_official", providerLabel: "MiniMax", integrationLabel: "Official API", models: ["MiniMax-Text-01"] },
    { providerId: "glm_official", providerLabel: "GLM", integrationLabel: "Official API", models: ["glm-4.7", "glm-4.5-air"] },
    { providerId: "volcengine_official", providerLabel: "火山引擎", integrationLabel: "Volcengine Ark API", models: ["doubao-1-5-pro-32k-250115", "deepseek-v3-2-251201"] },
  ],
  image_generation: [
    { providerId: "bailian_official", providerLabel: "阿里云百炼", integrationLabel: "Bailian Singapore API", models: ["qwen-image-3.0-pro", "qwen-image-2.7"] },
    { providerId: "google_official", providerLabel: "Google", integrationLabel: "Official API", models: ["Nanobanana2"] },
    { providerId: "openai_official", providerLabel: "OpenAI", integrationLabel: "Official API", models: ["gpt-image-2"] },
    { providerId: "openai_compatible", providerLabel: "OpenAI Compatible", integrationLabel: "Compatible API", models: [] },
    { providerId: "runninghub", providerLabel: "RunningHub", integrationLabel: "RunningHub API", models: ["seedream-v5-text-to-image", "seedream-v5-image-to-image"] },
  ],
  video_generation: [
    { providerId: "bailian_official", providerLabel: "阿里云百炼", integrationLabel: "Bailian API", models: ["happyhorse-1.1-t2v", "happyhorse-1.1-i2v", "happyhorse-1.1-r2v", "happyhorse-1.0-video-edit"] },
    { providerId: "minimax_official", providerLabel: "MiniMax 海螺", integrationLabel: "Official API", models: ["MiniMax-Hailuo-2.3", "MiniMax-Hailuo-2.3-Fast"] },
    { providerId: "gemini_official", providerLabel: "Gemini", integrationLabel: "Official API", models: ["Veo 3.1"] },
    { providerId: "openai_compatible", providerLabel: "OpenAI Compatible", integrationLabel: "Compatible API", models: [] },
    { providerId: "runninghub", providerLabel: "RunningHub", integrationLabel: "RunningHub API", models: ["Seedance Pro Text to Video", "Seedance Pro Image to Video", "Seedance Fast", "Seedance Mini", "MiniMax-H3 多模态参考生视频"] },
  ],
  audio_generation: [
    { providerId: "minimax_official", providerLabel: "MiniMax Audio", integrationLabel: "Official API", models: [
      "speech-2.8-hd", "speech-2.8-turbo", "speech-2.6-hd", "speech-2.6-turbo", "speech-02-hd", "speech-02-turbo",
      "music-2.6", "music-2.6-free", "music-cover", "music-cover-free",
    ] },
    { providerId: "runninghub", providerLabel: "RunningHub", integrationLabel: "RunningHub AI App", models: [] },
  ],
};
