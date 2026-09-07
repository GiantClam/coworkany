import { WORKBENCH_PROVIDER_CATALOG, type WorkbenchProviderCategory } from "@coworkany/workbench-ui";
import type { DesktopProviderConfig, ProviderCapability } from "./provider-config";

export type ConfigurableProviderCapability = ProviderCapability;
export type ProviderPlatformId = string;

export type ProviderPlatform = {
  readonly id: ProviderPlatformId;
  readonly label: { readonly zh: string; readonly en: string };
  readonly source: string;
  readonly baseUrl: string;
};

const CLOUD_CATEGORY_BY_CAPABILITY: Record<ConfigurableProviderCapability, WorkbenchProviderCategory> = {
  text: "text_generation",
  image: "image_generation",
  video: "video_generation",
  audio: "audio_generation",
};

const RUNTIME_BY_CLOUD_PROVIDER: Record<string, Pick<ProviderPlatform, "source" | "baseUrl">> = {
  siliconflow: { source: "siliconflow", baseUrl: "https://api.siliconflow.cn/v1" },
  openrouter: { source: "openrouter", baseUrl: "https://openrouter.ai/api/v1" },
  openai_compatible: { source: "openai-compatible", baseUrl: "" },
  qwen_official: { source: "qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  minimax_official: { source: "minimax", baseUrl: "https://api.minimaxi.com/v1" },
  glm_official: { source: "glm", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
  volcengine_official: { source: "volcengine", baseUrl: "https://ark.cn-beijing.volces.com/api/v3" },
  bailian_official: { source: "bailian", baseUrl: "https://dashscope.aliyuncs.com" },
  google_official: { source: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  openai_official: { source: "openai", baseUrl: "https://api.openai.com/v1" },
  gemini_official: { source: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  runninghub: { source: "runninghub", baseUrl: "https://www.runninghub.cn" },
};

function cloudPlatforms(capability: ConfigurableProviderCapability): readonly ProviderPlatform[] {
  return WORKBENCH_PROVIDER_CATALOG[CLOUD_CATEGORY_BY_CAPABILITY[capability]]
    // A generic OpenAI-compatible model list has no standard modality field.
    // It cannot prove that an account's returned model is a media model, so
    // keep it text-only instead of permitting text models in media settings.
    .filter((provider) => capability === "text" || provider.providerId !== "openai_compatible")
    .map((provider) => {
    const runtime = RUNTIME_BY_CLOUD_PROVIDER[provider.providerId] ?? { source: provider.providerId, baseUrl: "" };
    return {
      id: provider.providerId,
      label: { zh: provider.providerLabel, en: provider.providerLabel },
      source: runtime.source,
      baseUrl: runtime.baseUrl,
    };
  });
}

/** Directly mirrors the cloud governance Provider directory. */
export const PROVIDER_PLATFORM_OPTIONS: Readonly<Record<ConfigurableProviderCapability, readonly ProviderPlatform[]>> = {
  text: cloudPlatforms("text"),
  image: cloudPlatforms("image"),
  video: cloudPlatforms("video"),
  audio: cloudPlatforms("audio"),
};

export function providerPlatformForId(capability: ConfigurableProviderCapability, platformId: string | undefined) {
  return PROVIDER_PLATFORM_OPTIONS[capability].find((platform) => platform.id === platformId) ?? null;
}

export function platformIdForProvider(provider: DesktopProviderConfig | undefined, capability: ConfigurableProviderCapability): ProviderPlatformId | "" {
  const candidates = PROVIDER_PLATFORM_OPTIONS[capability];
  const providerId = provider?.id?.trim() ?? "";
  const source = (provider?.source ?? "").trim().toLowerCase();
  if (source === "pptoken" && candidates.some((platform) => platform.id === "openai_compatible")) return "openai_compatible";
  const direct = candidates.find((platform) => providerId === `${capability}-${platform.id}` || providerId === platform.id);
  if (direct) return direct.id;
  const matchingSource = candidates.filter((platform) => platform.source === source);
  return matchingSource.length === 1 ? matchingSource[0]!.id : "";
}

export function createPlatformProviderProfile(capability: ConfigurableProviderCapability, platformId: ProviderPlatformId): DesktopProviderConfig {
  const platform = providerPlatformForId(capability, platformId);
  if (!platform) throw new Error(`unsupported_provider_platform:${capability}:${platformId}`);
  return {
    id: `${capability}-${platform.id}`,
    source: platform.source,
    baseUrl: platform.baseUrl,
    capabilities: [capability],
    model: "",
    models: [],
  };
}
